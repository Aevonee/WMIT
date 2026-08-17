'use strict';

const DEMO_ATTENDANCE_PEOPLE = [
  { person_id: 'PERSON-DEMO-001', display_name: 'Demo Traveler', attendance_name: 'Demo Traveler', person_type: 'STAFF', role: 'Operations Staff', default_branch: 'Main Office', active: true },
  { person_id: 'PERSON-DEMO-002', display_name: 'Sample Companion', attendance_name: 'Sample Companion', person_type: 'INTERN', role: 'Intern', default_branch: 'Main Office', active: true },
  { person_id: 'PERSON-DEMO-003', display_name: 'Ana Cruz', attendance_name: 'Ana Cruz', person_type: 'STAFF', role: 'Sales Staff', default_branch: 'Makati', active: true },
  { person_id: 'PERSON-DEMO-004', display_name: 'Jhon Bagtasos', attendance_name: 'Jhon Bagtasos', name_aliases: ['Bagtasos, Jhon'], person_type: 'STAFF', role: 'Operations Staff', default_branch: 'North Branch', active: true },
  { person_id: 'PERSON-DEMO-005', display_name: 'Rina Santos', attendance_name: 'Rina Santos', person_type: 'STAFF', role: 'Finance Staff', default_branch: 'Main Office', active: true },
  { person_id: 'PERSON-DEMO-006', display_name: 'Absent Demo Intern', attendance_name: 'Absent Demo Intern', person_type: 'INTERN', role: 'Intern', default_branch: 'Main Office', active: true },
  { person_id: 'PERSON-DEMO-007', display_name: 'Conflicting Demo Staff', attendance_name: 'Conflicting Demo Staff', person_type: 'STAFF', role: 'Operations Staff', default_branch: 'Cebu Branch', active: true }
];

const DEMO_ATTENDANCE_ROSTER = DEMO_ATTENDANCE_PEOPLE.map((person) => ({
  employee_name: person.attendance_name,
  role: person.role,
  branch: person.default_branch,
  active: true
}));

const DEMO_ATTENDANCE_EVENTS = [
  { source_row_reference: 2, timestamp: '2026-08-12T08:02:00+08:00', employee_name: 'Demo Traveler', role: 'Operations Staff', branch: 'Main Office', action: 'Time In', selfie_link: 'https://private.example.test/selfie/001' },
  { source_row_reference: 3, timestamp: '2026-08-12T08:05:00+08:00', employee_name: 'Demo Traveler', role: 'Operations Staff', branch: 'Main Office', action: 'Time In', selfie_link: 'https://private.example.test/selfie/002' },
  { source_row_reference: 4, timestamp: '2026-08-12T17:01:00+08:00', employee_name: 'Demo Traveler', role: 'Operations Staff', branch: 'Main Office', action: 'Time Out', selfie_link: 'https://private.example.test/selfie/003' },
  { source_row_reference: 5, timestamp: '2026-08-12T09:12:00+08:00', employee_name: 'Sample Companion', role: 'Intern', branch: 'Main Office', action: 'Time In', selfie_link: 'https://private.example.test/selfie/004' },
  { source_row_reference: 6, timestamp: '2026-08-12T17:00:00+08:00', employee_name: 'Ana Cruz', role: 'Sales Staff', branch: 'Makati', action: 'Time Out', selfie_link: 'https://private.example.test/selfie/005' },
  { source_row_reference: 7, timestamp: '2026-08-11T22:30:00+08:00', employee_name: 'Bagtasos, Jhon', role: 'Operations Staff', branch: 'North Branch', action: 'Time In', selfie_link: 'https://private.example.test/selfie/006' },
  { source_row_reference: 8, timestamp: '2026-08-12T06:30:00+08:00', employee_name: 'Bagtasos, Jhon', role: 'Operations Staff', branch: 'North Branch', action: 'Time Out', selfie_link: 'https://private.example.test/selfie/007' },
  { source_row_reference: 9, timestamp: '2026-08-12T08:00:00+08:00', employee_name: 'Rina Santos', role: 'Finance Staff', branch: 'Main Office', action: 'Time In', selfie_link: 'https://private.example.test/selfie/008' },
  { source_row_reference: 10, timestamp: '2026-08-12T12:00:00+08:00', employee_name: 'Rina Santos', role: 'Finance Staff', branch: 'Main Office', action: 'Time Out', selfie_link: 'https://private.example.test/selfie/009' },
  { source_row_reference: 11, timestamp: '2026-08-12T17:00:00+08:00', employee_name: 'Rina Santos', role: 'Finance Staff', branch: 'Main Office', action: 'Time Out', selfie_link: 'https://private.example.test/selfie/010' },
  { source_row_reference: 12, timestamp: '2026-08-12T08:00:00+08:00', employee_name: 'Conflicting Demo Staff', role: 'Operations Staff', branch: 'Cebu Branch', action: 'Time Out', selfie_link: 'https://private.example.test/selfie/011' },
  { source_row_reference: 13, timestamp: '2026-08-12T08:30:00+08:00', employee_name: 'Conflicting Demo Staff', role: 'Operations Staff', branch: 'Cebu Branch', action: 'Time In', selfie_link: 'https://private.example.test/selfie/012' },
  { source_row_reference: 14, timestamp: '2026-08-12T12:00:00+08:00', employee_name: 'Conflicting Demo Staff', role: 'Operations Staff', branch: 'Cebu Branch', action: 'Time Out', selfie_link: 'https://private.example.test/selfie/013' },
  { source_row_reference: 15, timestamp: '2026-08-12T09:00:00+08:00', employee_name: 'Unknown Synthetic Person', role: 'Unknown', branch: 'Unknown Branch', action: 'Time In', selfie_link: 'https://private.example.test/selfie/014' }
];

module.exports = { DEMO_ATTENDANCE_PEOPLE, DEMO_ATTENDANCE_ROSTER, DEMO_ATTENDANCE_EVENTS };
