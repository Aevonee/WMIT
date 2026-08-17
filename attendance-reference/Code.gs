/**
 * Global Configuration Variables
 * Replace placeholders with your actual credentials and IDs
 */
const TELEGRAM_TOKEN = 'REDACTED_API_TOKEN'; 
const TELEGRAM_CHAT_ID = '-5430742663'; 
const DRIVE_FOLDER_ID = '1ExAawCxp4H6nDLcvC9KbAn-FZZxB5wyB'; 
const SPREADSHEET_ID = '1EPMA8MxHUaorQDKYMrBHsgTU_OisPRecTVaYJnRD7uc'; 

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('World Master International Travel - Attendance')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * INSTANT DROPDOWN AGENT: Pulls the names directly from the sheet roster on page load
 */
function getRosterNames() {
  try {
    return getRosterRecords_().map(record => record.name);
  } catch (e) {
    return ["Error loading names: " + e.toString()];
  }
}

/** Reads Active Roster by header name. Role is required for attendance. */
function getRosterRecords_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName("Active Roster");
  if (!sheet) throw new Error("Create an 'Active Roster' sheet.");
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const headers = {};
  values[0].forEach((value, index) => {
    const key = normalizeRosterHeader_(value);
    if (key) headers[key] = index;
  });
  const nameIndex = headers.name !== undefined ? headers.name : headers.employee_name;
  const roleIndex = headers.role;
  if (nameIndex === undefined) throw new Error("Active Roster needs a 'Name' or 'Employee Name' header.");
  if (roleIndex === undefined) throw new Error("Active Roster needs a 'Role' header with Staff or Intern values.");
  return values.slice(1).map(row => ({
    name: String(row[nameIndex] || '').trim(),
    role: String(row[roleIndex] || '').trim(),
    branch: headers.branch === undefined ? '' : String(row[headers.branch] || '').trim()
  })).filter(record => record.name);
}

function normalizeRosterHeader_(value) {
  return String(value === undefined || value === null ? '' : value)
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function findRosterRecord_(name) {
  const wanted = String(name || '').trim().toLowerCase();
  return getRosterRecords_().find(record => record.name.toLowerCase() === wanted) || null;
}

/** Resolve Attendance Log columns from its header row. */
function getAttendanceLogColumnMap_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headerValues = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const aliases = {
    timestamp: ['timestamp', 'time stamp', 'date time', 'datetime'],
    employee_name: ['employee name', 'employee', 'name', 'staff name'],
    role: ['role', 'position', 'job role'],
    branch: ['branch', 'location', 'office'],
    action: ['action', 'attendance action', 'event'],
    selfie_link: ['selfie link', 'selfie', 'photo link', 'image link']
  };
  const normalized = {};
  headerValues.forEach((value, index) => {
    const key = normalizeAttendanceLogHeader_(value);
    if (key && normalized[key] === undefined) normalized[key] = index;
  });
  const columns = {};
  Object.keys(aliases).forEach(field => aliases[field].some(alias => {
    if (normalized[alias] === undefined) return false;
    columns[field] = normalized[alias];
    return true;
  }));
  ['timestamp', 'employee_name', 'role', 'branch', 'action', 'selfie_link'].forEach(field => {
    if (columns[field] === undefined) {
      throw new Error("Attendance Log needs a '" + field.replace('_', ' ') + "' header. No row was written.");
    }
  });
  return columns;
}

function normalizeAttendanceLogHeader_(value) {
  return String(value === undefined || value === null ? '' : value)
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function appendAttendanceLogRecord_(sheet, record) {
  const columns = getAttendanceLogColumnMap_(sheet);
  const row = Array(sheet.getLastColumn()).fill('');
  row[columns.timestamp] = record.timestamp;
  row[columns.employee_name] = record.employee_name;
  row[columns.role] = record.role;
  row[columns.branch] = record.branch;
  row[columns.action] = record.action;
  row[columns.selfie_link] = record.selfie_link;
  const rowNumber = sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  return { rowNumber: rowNumber, columns: columns };
}

/** Run manually once if the Active Roster sheet does not yet have Role. */
function setupActiveRosterRoleColumn() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName("Active Roster");
  if (!sheet) throw new Error("Create an 'Active Roster' sheet first.");
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headerValues = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const hasRole = headerValues.some(value => normalizeRosterHeader_(value) === 'role');
  if (!hasRole) sheet.getRange(1, lastColumn + 1).setValue('Role');
  return "Active Roster now has a Role column. Enter Staff or Intern for each person.";
}

function processAttendance(name, role, action, base64Image) {
  try {
    // Role is controlled by Active Roster, not by a user-selectable form field.
    const rosterRecord = findRosterRecord_(name);
    if (!rosterRecord) return "Server Error: The selected name is not in Active Roster.";
    if (!rosterRecord.role) return "Server Error: Add Staff or Intern in the Active Roster Role column first.";
    role = rosterRecord.role;
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let logSheet = ss.getSheetByName("Attendance Log");
    
    if (!logSheet) {
      logSheet = ss.insertSheet("Attendance Log");
      logSheet.appendRow(["Timestamp", "Employee Name", "Role", "Branch", "Action", "Selfie Link"]);
    }
    
    const timestamp = new Date();
    const formattedDate = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    const datePrefix = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd");
    let fileUrl = "No Photo";
    
    if (base64Image) {
      const contentType = base64Image.substring(base64Image.indexOf(":") + 1, base64Image.indexOf(";"));
      const base64Data = base64Image.substring(base64Image.indexOf(",") + 1);
      const decodedBlob = Utilities.newBlob(Utilities.base64Decode(base64Data), contentType, datePrefix + "_" + name.replace(/[^a-zA-Z0-9]/g, "_") + "_" + action.replace(" ", "_") + ".jpg");
      
      // PER-DAY, PER-NAME Naming Rule Configuration
      const fileMetadata = {
        name: datePrefix + "_" + name.replace(/[^a-zA-Z0-9]/g, "_") + "_" + action.replace(" ", "_") + ".jpg",
        mimeType: contentType,
        parents: [DRIVE_FOLDER_ID]
      };
      
      const uploadedFile = Drive.Files.create(fileMetadata, decodedBlob);
      fileUrl = "https://drive.google.com/file/d/" + uploadedFile.id + "/view?usp=drivesdk";
    }
    
    const writeResult = appendAttendanceLogRecord_(logSheet, {
      timestamp: formattedDate,
      employee_name: name,
      role: role,
      branch: rosterRecord.branch,
      action: action,
      selfie_link: fileUrl
    });
    
    try {
      sendTelegramNotice(name, role, action, formattedDate, fileUrl);
    } catch (teleErr) {
      // Keep the selfie link intact if Telegram fails.
      Logger.log("Telegram Failed for attendance row " + writeResult.rowNumber + ": " + teleErr.toString());
    }
    
    return "Success";
  } catch (err) {
    return "Server Error: " + err.toString();
  }
}

function sendTelegramNotice(name, role, action, time, url) {
  try {
    // Extract the raw file ID from the Google Drive link string
    const fileId = url.match(/[-\w]{25,}/);
    
    // Convert to a raw, direct public image routing asset link for Telegram's fetch preview engine
    const directImageUrl = "https://drive.google.com/uc?export=download&id=" + fileId;
    
    const botUrl = "https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendPhoto";
    const emoji = (action === "Time In") ? "🟩" : "🟥";
    const roleTag = (role === "Intern") ? "🎓 [INTERN]" : "💼 [STAFF]";
    
    const caption = `${emoji} <b>ATTENDANCE UPDATE</b> ${emoji}\n\n` +
                    `<b>Name:</b> ${name} ${roleTag}\n` +
                    `<b>Action:</b> ${action.toUpperCase()}\n` +
                    `<b>Time:</b> <code>${time}</code>\n\n` +
                    `<a href="${url}">📁 View Original File in Drive</a>`;
    
    const payload = {
      "chat_id": TELEGRAM_CHAT_ID,
      "photo": directImageUrl, // Passes the direct routing link so Telegram renders the photo natively
      "caption": caption,
      "parse_mode": "HTML"
    };
    
    const options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };
    
    UrlFetchApp.fetch(botUrl, options);
    return true;
  } catch (e) {
    return e.toString();
  }
}

/**
 * FEATURE C: AUTOMATED DAILY REPORT TRIGGER
 * Compiles all clock-ins/outs for the current day and fires a clean summary table to Telegram
 */
function generateDailyTelegramSummary() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const logSheet = ss.getSheetByName("Attendance Log");
    if (!logSheet) return;
    
    const lastRow = logSheet.getLastRow();
    if (lastRow < 2) return;
    
    const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    const columns = getAttendanceLogColumnMap_(logSheet);
    const data = logSheet.getRange(2, 1, lastRow - 1, logSheet.getLastColumn()).getValues();
    
    let summaryIns = [];
    let summaryOuts = [];
    
    data.forEach(row => {
      const rowTimestamp = row[columns.timestamp]; // Date object or string
      let rowDateStr = "";
      if (rowTimestamp instanceof Date) {
        rowDateStr = Utilities.formatDate(rowTimestamp, Session.getScriptTimeZone(), "yyyy-MM-dd");
      } else {
        rowDateStr = rowTimestamp.toString().substring(0, 10);
      }
      
      // If the log match belongs to today's date context
      if (rowDateStr === todayStr) {
        const name = row[columns.employee_name];
        const role = row[2] === "Intern" ? "🎓" : "💼";
        const action = row[columns.action];
        const timeStr = rowTimestamp instanceof Date ? Utilities.formatDate(rowTimestamp, Session.getScriptTimeZone(), "hh:mm a") : rowTimestamp.toString().substring(11, 16);
        
        if (action === "Time In") {
          summaryIns.push(`• ${timeStr} - <b>${name}</b> ${role}`);
        } else if (action === "Time Out") {
          summaryOuts.push(`• ${timeStr} - <b>${name}</b> ${role}`);
        }
      }
    });
    
    let reportMessage = `📊 <b>DAILY ATTENDANCE SUMMARY</b>\n` +
                        `📅 <b>Date:</b> <code>${todayStr}</code>\n\n` +
                        `🌅 <b>TIME IN LOGS:</b>\n` + 
                        (summaryIns.length > 0 ? summaryIns.join("\n") : "<i>No entries recorded</i>") + 
                        `\n\n🌇 <b>TIME OUT LOGS:</b>\n` + 
                        (summaryOuts.length > 0 ? summaryOuts.join("\n") : "<i>No entries recorded</i>");
    
    const botUrl = "https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendMessage";
    const payload = { "chat_id": TELEGRAM_CHAT_ID, "text": reportMessage, "parse_mode": "HTML" };
    const options = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
    UrlFetchApp.fetch(botUrl, options);
  } catch (err) {
    Logger.log("Report Error: " + err.toString());
  }
}
