'use strict';

const SYNTHETIC_CONTEXT = { actor: 'TEST_USER', agent: 'FOUNDATION_TEST' };

const records = {
  lead: {
    lead_id: 'LEAD-TEST-000001',
    received_at: '2026-08-12T09:00:00+08:00',
    source: 'Other',
    lead_type: 'B2C',
    contact_name: 'Fictional Traveler',
    contact_email: 'traveler@example.test',
    destination: 'Synthetic City',
    travel_start: '2026-12-01',
    travel_end: '2026-12-05',
    pax_count: 2,
    currency: 'PHP'
  },
  client: {
    client_id: 'CLIENT-TEST-000001',
    client_type: 'Individual',
    legal_name: 'Fictional Traveler',
    display_name: 'Fictional Traveler',
    primary_email: 'traveler@example.test',
    country: 'Philippines',
    status: 'Active'
  },
  traveler: {
    traveler_id: 'PASSENGER-TEST-000001',
    client_id: 'CLIENT-TEST-000001',
    first_name: 'Fictional',
    last_name: 'Traveler',
    nationality: 'Philippine',
    status: 'Active'
  },
  traveler2: {
    traveler_id: 'PASSENGER-TEST-000002',
    client_id: 'CLIENT-TEST-000001',
    first_name: 'Second',
    last_name: 'Traveler',
    nationality: 'Philippine',
    status: 'Active'
  },
  supplier: {
    supplier_id: 'SUPPLIER-TEST-000001',
    supplier_type: 'Tour Operator',
    legal_name: 'Synthetic Tours Ltd.',
    display_name: 'Synthetic Tours',
    country: 'Philippines',
    primary_email: 'supplier@example.test',
    status: 'Active'
  },
  supplier2: {
    supplier_id: 'SUPPLIER-TEST-000002',
    supplier_type: 'Transport Provider',
    legal_name: 'Synthetic Transport Ltd.',
    display_name: 'Synthetic Transport',
    country: 'Philippines',
    primary_email: 'transport@example.test',
    status: 'Active'
  },
  quotation: {
    quotation_id: 'QUOTATION-TEST-000001',
    lead_id: 'LEAD-TEST-000001',
    client_id: 'CLIENT-TEST-000001',
    quotation_date: '2026-08-12',
    valid_until: '2026-08-19',
    destination: 'Synthetic City',
    travel_start: '2026-12-01',
    travel_end: '2026-12-05',
    pax_count: 2,
    currency: 'PHP',
    supplier_cost_total: 10000,
    markup_total: 1500,
    fees_total: 250,
    tax_total: 0,
    discount_total: 0,
    client_total: 11750,
    inclusions: 'Synthetic hotel, transfer, and tour services',
    exclusions: 'Personal expenses',
    payment_terms: '50% deposit; balance before travel',
    status: 'Draft'
  },
  quotationItem1: {
    quotation_item_id: 'QUOTATION_ITEM-TEST-000001',
    quotation_id: 'QUOTATION-TEST-000001',
    service_type: 'Hotel',
    description: 'Synthetic hotel stay',
    supplier_id: 'SUPPLIER-TEST-000001',
    quantity: 4,
    unit_cost: 2000,
    unit_selling_price: 2500,
    markup_amount: 2000,
    currency: 'PHP',
    service_start: '2026-12-01',
    service_end: '2026-12-05'
  },
  quotationItem2: {
    quotation_item_id: 'QUOTATION_ITEM-TEST-000002',
    quotation_id: 'QUOTATION-TEST-000001',
    service_type: 'Transfer',
    description: 'Synthetic airport transfer',
    supplier_id: 'SUPPLIER-TEST-000001',
    quantity: 1,
    unit_cost: 1000,
    unit_selling_price: 1250,
    markup_amount: 250,
    currency: 'PHP',
    service_start: '2026-12-01'
  },
  booking: {
    booking_id: 'BOOKING-TEST-000001',
    quotation_id: 'QUOTATION-TEST-000001',
    client_id: 'CLIENT-TEST-000001',
    booking_date: '2026-08-12',
    travel_start: '2026-12-01',
    travel_end: '2026-12-05',
    destination: 'Synthetic City',
    currency: 'PHP',
    client_total: 11750,
    supplier_cost_total: 10000,
    status: 'Draft'
  },
  bookingTraveler1: {
    booking_traveler_id: 'BOOKING_TRAVELER-TEST-000001',
    booking_id: 'BOOKING-TEST-000001',
    traveler_id: 'PASSENGER-TEST-000001',
    is_primary: true,
    traveler_role: 'Lead Traveler'
  },
  bookingTraveler2: {
    booking_traveler_id: 'BOOKING_TRAVELER-TEST-000002',
    booking_id: 'BOOKING-TEST-000001',
    traveler_id: 'PASSENGER-TEST-000002',
    is_primary: false,
    traveler_role: 'Traveler'
  },
  bookingItem1: {
    booking_item_id: 'BOOKING_ITEM-TEST-000001',
    booking_id: 'BOOKING-TEST-000001',
    quotation_item_id: 'QUOTATION_ITEM-TEST-000001',
    service_type: 'Hotel',
    supplier_id: 'SUPPLIER-TEST-000001',
    description: 'Synthetic hotel stay',
    service_start: '2026-12-01',
    service_end: '2026-12-05',
    quantity: 4,
    supplier_cost: 2000,
    selling_price: 2500,
    currency: 'PHP',
    supplier_reference: 'SYN-HOTEL-001',
    status: 'Draft'
  },
  bookingItem2: {
    booking_item_id: 'BOOKING_ITEM-TEST-000002',
    booking_id: 'BOOKING-TEST-000001',
    service_type: 'Transfer',
    supplier_id: 'SUPPLIER-TEST-000002',
    description: 'Synthetic airport transfer',
    service_start: '2026-12-01',
    quantity: 1,
    supplier_cost: 1000,
    selling_price: 1250,
    currency: 'PHP',
    supplier_reference: 'SYN-TRANSFER-001',
    status: 'Draft'
  },
  bookingItem3: {
    booking_item_id: 'BOOKING_ITEM-TEST-000003',
    booking_id: 'BOOKING-TEST-000001',
    service_type: 'Tour',
    supplier_id: 'SUPPLIER-TEST-000001',
    description: 'Synthetic city tour',
    service_start: '2026-12-03',
    quantity: 2,
    supplier_cost: 1000,
    selling_price: 1250,
    currency: 'PHP',
    supplier_reference: 'SYN-TOUR-001',
    status: 'Draft'
  },
  departure: {
    departure_id: 'DEPARTURE-TEST-000001',
    name: 'Synthetic City Practice Departure',
    destination: 'Synthetic City',
    departure_type: 'WMIT Own Group',
    start_date: '2026-12-01',
    end_date: '2026-12-05',
    capacity: 10,
    readiness_percent: 0,
    status: 'Draft'
  },
  invoice: {
    invoice_id: 'INVOICE-TEST-000001',
    invoice_number: 'INV-TEST-000001',
    booking_id: 'BOOKING-TEST-000001',
    client_id: 'CLIENT-TEST-000001',
    invoice_date: '2026-08-12',
    due_date: '2026-08-19',
    currency: 'PHP',
    subtotal: 11750,
    discount_total: 0,
    fees_total: 0,
    tax_total: 0,
    total: 11750,
    amount_paid: 5000,
    balance_due: 6750,
    status: 'Draft'
  },
  invoiceItem1: {
    invoice_item_id: 'INVOICE_ITEM-TEST-000001',
    invoice_id: 'INVOICE-TEST-000001',
    booking_item_id: 'BOOKING_ITEM-TEST-000001',
    booking_id: 'BOOKING-TEST-000001',
    description: 'Synthetic hotel stay',
    quantity: 4,
    unit_price: 2500,
    amount: 10000,
    currency: 'PHP'
  },
  invoiceItem2: {
    invoice_item_id: 'INVOICE_ITEM-TEST-000002',
    invoice_id: 'INVOICE-TEST-000001',
    booking_item_id: 'BOOKING_ITEM-TEST-000002',
    booking_id: 'BOOKING-TEST-000001',
    description: 'Synthetic airport transfer',
    quantity: 1,
    unit_price: 1250,
    amount: 1250,
    currency: 'PHP'
  },
  payment: {
    payment_id: 'PAYMENT-TEST-000001',
    payment_direction: 'FROM_CLIENT',
    invoice_id: 'INVOICE-TEST-000001',
    booking_id: 'BOOKING-TEST-000001',
    client_id: 'CLIENT-TEST-000001',
    payment_date: '2026-08-12',
    amount: 5000,
    currency: 'PHP',
    method: 'Bank Transfer',
    status: 'Pending Verification'
  },
  payment2: {
    payment_id: 'PAYMENT-TEST-000002',
    payment_direction: 'FROM_CLIENT',
    invoice_id: 'INVOICE-TEST-000001',
    booking_id: 'BOOKING-TEST-000001',
    client_id: 'CLIENT-TEST-000001',
    payment_date: '2026-08-20',
    amount: 3000,
    currency: 'PHP',
    method: 'Cash',
    reference: 'SYN-PAY-002',
    status: 'Pending Verification'
  },
  document: {
    document_id: 'DOCUMENT-TEST-000001',
    external_file_id: 'synthetic-file-000001',
    file_name: 'synthetic-confirmation.pdf',
    source_type: 'SUPPLIER',
    source_name: 'Synthetic Tours',
    related_entity_type: 'Booking',
    related_entity_id: 'BOOKING-TEST-000001',
    document_type: 'UNKNOWN',
    extraction_status: 'NOT_PROCESSED',
    extraction_confidence: 0,
    status: 'Needs Review'
  },
  supplierTariff: {
    supplier_tariff_id: 'SUPPLIER_TARIFF-TEST-000001',
    supplier_id: 'SUPPLIER-TEST-000001',
    source_document_id: 'DOCUMENT-TEST-000001',
    destination: 'Synthetic City',
    package_name: 'Synthetic 5D4N Package',
    duration: '5D4N',
    hotel: 'Synthetic Hotel',
    room_type: 'Twin',
    minimum_pax: 2,
    adult_rate: 10000,
    single_supplement: 2500,
    currency: 'PHP',
    review_status: 'Needs Review',
    status: 'Draft'
  },
  supplierBooking: {
    supplier_booking_id: 'SUPPLIER_BOOKING-TEST-000001',
    supplier_id: 'SUPPLIER-TEST-000001',
    booking_id: 'BOOKING-TEST-000001',
    supplier_reference: 'SYN-SUP-001',
    service_description: 'Synthetic hotel and transfer services',
    supplier_cost: 10000,
    currency: 'PHP',
    deposit: 3000,
    balance: 7000,
    deposit_due_date: '2026-10-01',
    final_payment_due_date: '2026-11-01',
    status: 'Draft'
  },
  supplierBooking2: {
    supplier_booking_id: 'SUPPLIER_BOOKING-TEST-000002',
    supplier_id: 'SUPPLIER-TEST-000002',
    booking_id: 'BOOKING-TEST-000001',
    supplier_reference: 'SYN-SUP-002',
    service_description: 'Synthetic transfer service',
    supplier_cost: 1000,
    currency: 'PHP',
    deposit: 300,
    balance: 700,
    final_payment_due_date: '2026-11-15',
    status: 'Draft'
  },
  supplierBookingItem1: {
    supplier_booking_item_id: 'SUPPLIER_BOOKING_ITEM-TEST-000001',
    supplier_booking_id: 'SUPPLIER_BOOKING-TEST-000001',
    booking_item_id: 'BOOKING_ITEM-TEST-000001',
    allocated_supplier_cost: 8000,
    currency: 'PHP'
  },
  supplierBookingItem2: {
    supplier_booking_item_id: 'SUPPLIER_BOOKING_ITEM-TEST-000002',
    supplier_booking_id: 'SUPPLIER_BOOKING-TEST-000001',
    booking_item_id: 'BOOKING_ITEM-TEST-000003',
    allocated_supplier_cost: 1000,
    currency: 'PHP'
  },
  supplierBookingItem3: {
    supplier_booking_item_id: 'SUPPLIER_BOOKING_ITEM-TEST-000003',
    supplier_booking_id: 'SUPPLIER_BOOKING-TEST-000002',
    booking_item_id: 'BOOKING_ITEM-TEST-000002',
    allocated_supplier_cost: 1000,
    currency: 'PHP'
  },
  invoiceBooking: {
    invoice_booking_id: 'INVOICE_BOOKING-TEST-000001',
    invoice_id: 'INVOICE-TEST-000001',
    booking_id: 'BOOKING-TEST-000001',
    relationship_type: 'Primary client booking'
  },
  documentSupplierVoucher: {
    document_id: 'DOCUMENT-TEST-000002',
    external_file_id: 'synthetic-file-000002',
    file_name: 'synthetic-supplier-voucher.pdf',
    source_type: 'SUPPLIER',
    source_name: 'Synthetic Tours',
    related_entity_type: 'SupplierBooking',
    related_entity_id: 'SUPPLIER_BOOKING-TEST-000001',
    document_type: 'TOUR_OPERATOR_VOUCHER',
    extraction_status: 'EXTRACTED',
    extraction_confidence: 75,
    status: 'Needs Review'
  },
  documentWmitInvoice: {
    document_id: 'DOCUMENT-TEST-000003',
    external_file_id: 'synthetic-file-000003',
    file_name: 'synthetic-wmit-invoice.pdf',
    source_type: 'WMIT',
    source_name: 'WMIT',
    related_entity_type: 'Invoice',
    related_entity_id: 'INVOICE-TEST-000001',
    document_type: 'WMIT_INVOICE',
    extraction_status: 'EXTRACTED',
    extraction_confidence: 90,
    status: 'Classified'
  },
  documentLink1: {
    document_link_id: 'DOCUMENT_LINK-TEST-000001',
    document_id: 'DOCUMENT-TEST-000002',
    related_entity_type: 'SupplierBooking',
    related_entity_id: 'SUPPLIER_BOOKING-TEST-000001',
    relationship_type: 'Supplier confirmation'
  },
  documentLink2: {
    document_link_id: 'DOCUMENT_LINK-TEST-000002',
    document_id: 'DOCUMENT-TEST-000002',
    related_entity_type: 'BookingItem',
    related_entity_id: 'BOOKING_ITEM-TEST-000001',
    relationship_type: 'Voucher covers service'
  },
  documentLink3: {
    document_link_id: 'DOCUMENT_LINK-TEST-000003',
    document_id: 'DOCUMENT-TEST-000003',
    related_entity_type: 'Invoice',
    related_entity_id: 'INVOICE-TEST-000001',
    relationship_type: 'Invoice source document'
  },
  task: {
    task_id: 'TASK-TEST-000001',
    related_type: 'Booking',
    related_id: 'BOOKING-TEST-000001',
    title: 'Review synthetic booking',
    priority: 'Medium',
    status: 'Open'
  }
};

module.exports = { records, SYNTHETIC_CONTEXT };
