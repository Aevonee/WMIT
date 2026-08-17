'use strict';

/**
 * Read-only HR and Payroll Officer specialist boundary.
 *
 * This is intentionally a controlled capability, not an autonomous agent or
 * payroll engine. It may read the attendance projection through
 * AttendanceService, but it cannot write attendance, change roster records,
 * view selfie links, calculate pay, or perform HR actions.
 */
class HrPayrollOfficer {
  constructor(options) {
    const opts = options || {};
    this.attendanceService = opts.attendanceService;
    this.agentId = opts.agentId || 'HR_PAYROLL_OFFICER';
  }

  profile() {
    return {
      agent_id: this.agentId,
      display_name: 'HR and Payroll Officer',
      domain: 'ATTENDANCE_MONITORING',
      read_only: true,
      capabilities: [
        'attendance_dashboard',
        'attendance_history',
        'attendance_exceptions',
        'attendance_source_status'
      ],
      unavailable_capabilities: [
        'payroll_calculation',
        'salary_calculation',
        'overtime_calculation',
        'deductions',
        'leave_management',
        'roster_changes',
        'attendance_corrections',
        'selfie_access'
      ],
      policy_note: 'Attendance policy, payroll rules, and HR permissions are not configured.'
    };
  }

  requireService() {
    if (!this.attendanceService) throw new Error('The HR and Payroll Officer has no attendance service configured.');
  }

  read(method, filters) {
    this.requireService();
    const result = this.attendanceService[method](filters || {});
    const wrap = (data) => ({
      agent: this.profile(),
      read_only: true,
      data
    });
    return result && typeof result.then === 'function' ? result.then(wrap) : wrap(result);
  }

  dailyAttendance(filters) { return this.read('dashboard', filters); }
  attendanceHistory(filters) { return this.read('history', filters); }
  attendanceExceptions(filters) { return this.read('exceptions', filters); }
}

module.exports = { HrPayrollOfficer };
