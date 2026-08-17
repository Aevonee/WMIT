'use strict';

const REFERENCE_DOCUMENTS = Object.freeze([
  {
    fileName: '0128NexplorerPackages_Philippines.pdf',
    expectedSource: 'SUPPLIER',
    expectedType: 'SUPPLIER_TARIFF',
    confidenceThreshold: 0.8,
    expectedFields: ['supplier', 'validity_start', 'validity_end', 'package', 'hotel_name', 'amount', 'currency', 'optional_services'],
    expectedValues: { supplier: 'nexplorer@nexplorer.asia', validity_start: '2026-04-01', validity_end: '2027-03-31', packageIncludes: 'BALI', hotelIncludes: 'POP KUTA BEACH HOTEL', amount: 80, currency: 'USD' }
  },
  {
    fileName: 'BUS3-Memo-for-FEB27-MAR03-6D4N-Da-Nang-Tour.pdf',
    expectedSource: 'TOUR_OPERATOR',
    expectedType: 'TOUR_OPERATOR_MEMO',
    confidenceThreshold: 0.8,
    expectedFields: ['pax_count', 'flight_number', 'hotel_name', 'activity', 'duration'],
    expectedValues: { pax_count: 28, flight_number: 'VJ8021', hotelIncludes: 'DANA CITIHOTEL', duration: '6D4N' }
  },
  {
    fileName: 'Cruz-Korea-May-06.pdf',
    expectedSource: 'WMIT',
    expectedType: 'WMIT_INVOICE',
    confidenceThreshold: 0.8,
    expectedFields: ['client', 'invoice_number', 'travel_start', 'travel_end', 'pax_count', 'amount', 'currency'],
    expectedValues: { client: 'Guia Barlaan Cruz', invoice_number: 'WMIT-0207-001-2026', travel_start: '2026-05-06', travel_end: '2026-05-10', pax_count: 2, amount: 84991, currency: 'PHP' }
  },
  {
    fileName: 'ICN_0506.0510_Agasang - Invoice.pdf',
    expectedSource: 'WMIT',
    expectedType: 'WMIT_INVOICE',
    confidenceThreshold: 0.8,
    expectedFields: ['client', 'invoice_number', 'travel_start', 'travel_end', 'amount', 'currency', 'deposit', 'balance'],
    expectedValues: { client: 'Guia Barlaan Cruz', invoice_number: '2026-020701', travel_start: '2026-05-06', travel_end: '2026-05-10', amount: 86791, currency: 'PHP', deposit: 2000, balance: 1800 }
  },
  {
    fileName: 'Quotation_Robert.pdf',
    expectedSource: 'WMIT',
    expectedType: 'WMIT_QUOTATION',
    confidenceThreshold: 0.8,
    expectedFields: ['client', 'destination', 'travel_start', 'travel_end', 'package', 'amount', 'currency'],
    expectedValues: { client: 'Robert', destination: 'VIETNAM', travel_start: '2026-10-07', travel_end: '2026-10-11', packageIncludes: 'VIETNAM', amount: 41888, currency: 'PHP' }
  },
  {
    fileName: 'Scorptec Computers_Quotation.Zambales.0224.pdf',
    expectedSource: 'WMIT',
    expectedType: 'WMIT_QUOTATION',
    confidenceThreshold: 0.8,
    expectedFields: ['client', 'destination', 'travel_start', 'travel_end', 'amount', 'currency'],
    expectedValues: { client: 'SCORPTECH COMPUTERS', destination: 'ZAMBALES', travel_start: '2026-02-24', travel_end: '2026-02-26', amount: 13998, currency: 'PHP' }
  },
  {
    fileName: 'SV-KOR- APR 01-APR 06 5J.pdf',
    expectedSource: 'TOUR_OPERATOR',
    expectedType: 'TOUR_OPERATOR_VOUCHER',
    confidenceThreshold: 0.8,
    expectedFields: ['travel_start', 'travel_end', 'pax_count', 'passenger', 'hotel_name', 'flight_number', 'activity', 'meal_plan'],
    expectedValues: { travel_start: '2026-04-01', travel_end: '2026-04-06', pax_count: 20, passenger: 'CIELO MACAHILIG', hotelIncludes: 'SMART STAY HOTEL', flight_number: '5J188' }
  },
  {
    fileName: 'UOS-PH-CJ-CA-20261010-016-89465.pdf',
    expectedSource: 'SUPPLIER',
    expectedType: 'SUPPLIER_QUOTATION',
    confidenceThreshold: 0.8,
    expectedFields: ['supplier', 'supplier_reference', 'pax_count', 'package', 'amount', 'deposit', 'balance', 'currency'],
    expectedValues: { supplier: 'UOS Travel Corp', supplier_reference: 'UOS-PH-CJ-CA-20261010-016-89465', pax_count: 2, packageIncludes: 'Chengdu+Jiuzhaigou', amount: 1058, deposit: 600, balance: 458, currency: 'USD' }
  }
]);

module.exports = { REFERENCE_DOCUMENTS };
