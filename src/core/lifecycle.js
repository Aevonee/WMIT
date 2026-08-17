'use strict';

const TRANSITIONS = {
  Lead: {
    New: ['Contacted', 'Qualified', 'Lost', 'Closed'],
    Contacted: ['Qualified', 'Quoted', 'Lost', 'Closed'],
    Qualified: ['Quoted', 'Won', 'Lost', 'Closed'],
    Quoted: ['Won', 'Lost', 'Closed'],
    Won: ['Closed'],
    Lost: ['Closed'],
    Closed: []
  },
  Quotation: {
    Draft: ['Approved', 'Rejected', 'Expired'],
    Approved: ['Sent', 'Rejected', 'Expired'],
    Sent: ['Accepted', 'Rejected', 'Expired'],
    Accepted: ['Expired'],
    Rejected: [],
    Expired: []
  },
  Booking: {
    Draft: ['Pending Confirmation', 'Cancelled'],
    'Pending Confirmation': ['Confirmed', 'Cancelled'],
    Confirmed: ['Completed', 'Cancelled'],
    Cancelled: [],
    Completed: []
  },
  Invoice: {
    Draft: ['Approved', 'Cancelled'],
    Approved: ['Sent', 'Cancelled'],
    Sent: ['Partially Paid', 'Paid', 'Overdue', 'Cancelled'],
    'Partially Paid': ['Paid', 'Overdue', 'Cancelled'],
    Overdue: ['Partially Paid', 'Paid', 'Cancelled'],
    Paid: [],
    Cancelled: []
  },
  SupplierBooking: {
    Draft: ['Requested', 'Cancelled'],
    Requested: ['Pending Confirmation', 'Confirmed', 'Cancelled'],
    'Pending Confirmation': ['Confirmed', 'Cancelled'],
    Confirmed: ['Completed', 'Cancelled'],
    Cancelled: [],
    Completed: []
  },
  Payment: {
    'Pending Verification': ['Verified', 'Rejected', 'Reversed'],
    Verified: ['Reversed'],
    Rejected: [],
    Reversed: []
  }
};

module.exports = { TRANSITIONS };
