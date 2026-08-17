'use strict';

const SCHEMA_VERSION = '1.4.0-quotation-payments-itinerary';

const COMMON_AUDIT_FIELDS = {
  created_at: { type: 'datetime', required: true },
  created_by: { type: 'string', required: true },
  updated_at: { type: 'datetime', required: true },
  updated_by: { type: 'string', required: true },
  record_version: { type: 'integer', required: true }
};

const OPERATIONAL_ENTITY_TYPES = [
  'Client', 'Contact', 'Traveler', 'Lead', 'Quotation', 'QuotationItem',
  'Booking', 'BookingTraveler', 'BookingItem', 'Departure', 'Supplier',
  'Invoice', 'InvoiceItem', 'Payment', 'Document',
  'SupplierTariff', 'SupplierBooking', 'SupplierBookingItem',
  'InvoiceBooking', 'DocumentLink', 'Task'
];

const SCHEMA = {
  Client: {
    tableName: 'Clients',
    idField: 'client_id',
    prefix: 'CLIENT',
    yearBased: false,
    statusField: 'status',
    uniqueFields: [['display_name', 'primary_email']],
    fields: {
      client_id: { type: 'id', required: true },
      client_type: { type: 'enum', required: true, allowed: ['Individual', 'Family', 'Company', 'Agency', 'Organization'] },
      legal_name: { type: 'string', required: true },
      display_name: { type: 'string', required: true },
      primary_email: { type: 'email', required: false },
      primary_phone: { type: 'string', required: false },
      country: { type: 'string', required: false },
      source_lead_id: { type: 'id', required: false, references: 'Lead' },
         status: { type: 'enum', required: true },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  Contact: {
    tableName: 'Contacts',
    idField: 'contact_id',
    prefix: 'CONTACT',
    yearBased: false,
    statusField: 'status',
    fields: {
      contact_id: { type: 'id', required: true },
      owner_type: { type: 'enum', required: true, allowed: ['Client', 'Supplier'] },
      owner_id: { type: 'id', required: true },
      contact_type: { type: 'enum', required: true, allowed: ['Email', 'Phone', 'WhatsApp', 'Viber', 'Other'] },
      contact_value: { type: 'string', required: true },
      is_primary: { type: 'boolean', required: true },
         status: { type: 'enum', required: true },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    },
    polymorphicReferences: [
      { typeField: 'owner_type', idField: 'owner_id', allowedTypes: ['Client', 'Supplier'] }
    ]
  },
  Traveler: {
    tableName: 'Travelers',
    idField: 'traveler_id',
    prefix: 'PASSENGER',
    yearBased: true,
    statusField: 'status',
    fields: {
      traveler_id: { type: 'id', required: true },
      client_id: { type: 'id', required: false, references: 'Client' },
      first_name: { type: 'string', required: true },
      middle_name: { type: 'string', required: false },
      last_name: { type: 'string', required: true },
      date_of_birth: { type: 'date', required: false },
      nationality: { type: 'string', required: false },
      status: { type: 'enum', required: true },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  Lead: {
    tableName: 'Leads',
    idField: 'lead_id',
    prefix: 'LEAD',
    yearBased: true,
    statusField: 'status',
    uniqueFields: [['contact_email', 'contact_phone', 'destination']],
    fields: {
      lead_id: { type: 'id', required: true },
      received_at: { type: 'datetime', required: true },
      source: { type: 'enum', required: true, allowed: ['Facebook', 'B2B', 'WhatsApp', 'Viber', 'Email', 'Walk-in', 'Referral', 'Expo', 'Repeat Client', 'Website', 'Other'] },
      lead_type: { type: 'enum', required: true, allowed: ['B2B', 'B2C'] },
      client_id: { type: 'id', required: false, references: 'Client' },
      contact_id: { type: 'id', required: false, references: 'Contact' },
      traveler_id: { type: 'id', required: false, references: 'Traveler' },
      contact_name: { type: 'string', required: true },
      company: { type: 'string', required: false },
      agency: { type: 'string', required: false },
      account_type: { type: 'string', required: false },
      account_manager: { type: 'string', required: false },
      contact_email: { type: 'email', required: false },
      contact_phone: { type: 'string', required: false },
      destination: { type: 'string', required: false },
      travel_start: { type: 'date', required: false },
      travel_end: { type: 'date', required: false },
      pax_count: { type: 'integer', required: false },
      estimated_value: { type: 'amount', required: false },
      currency: { type: 'currency', required: false },
      assigned_to: { type: 'string', required: false },
      requirements: { type: 'string', required: false },
      status: { type: 'enum', required: true },
      next_follow_up_at: { type: 'datetime', required: false },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  Quotation: {
    tableName: 'Quotations',
    idField: 'quotation_id',
    prefix: 'QUOTATION',
    yearBased: true,
    statusField: 'status',
    fields: {
      quotation_id: { type: 'id', required: true },
      lead_id: { type: 'id', required: true, references: 'Lead' },
      client_id: { type: 'id', required: false, references: 'Client' },
      contact_id: { type: 'id', required: false, references: 'Contact' },
      quotation_date: { type: 'date', required: true },
      valid_until: { type: 'date', required: false },
      destination: { type: 'string', required: false },
      travel_start: { type: 'date', required: false },
      travel_end: { type: 'date', required: false },
      pax_count: { type: 'integer', required: false },
      currency: { type: 'currency', required: true },
      supplier_cost_total: { type: 'amount', required: true },
      markup_total: { type: 'amount', required: true },
      fees_total: { type: 'amount', required: true },
      tax_total: { type: 'amount', required: true },
      discount_total: { type: 'amount', required: true },
      client_total: { type: 'amount', required: true },
      inclusions: { type: 'string', required: false },
      exclusions: { type: 'string', required: false },
      payment_terms: { type: 'string', required: false },
      payment_currency_policy: { type: 'string', required: false },
      itinerary: { type: 'string', required: false },
      flight_details: { type: 'string', required: false },
      client_notes: { type: 'string', required: false },
      internal_notes: { type: 'string', required: false },
      assigned_to: { type: 'string', required: false },
      status: { type: 'enum', required: true },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  QuotationItem: {
    tableName: 'Quotation Items',
    idField: 'quotation_item_id',
    prefix: 'QUOTATION_ITEM',
    yearBased: true,
    fields: {
      quotation_item_id: { type: 'id', required: true },
      quotation_id: { type: 'id', required: true, references: 'Quotation' },
      service_type: { type: 'enum', required: true, allowed: ['Flight', 'Hotel', 'Transfer', 'Tour', 'Tour Package', 'Land Arrangement', 'Ticket', 'Other'] },
      description: { type: 'string', required: true },
      supplier_id: { type: 'id', required: false, references: 'Supplier' },
      quantity: { type: 'amount', required: true },
      unit_cost: { type: 'amount', required: true },
      unit_selling_price: { type: 'amount', required: true },
      markup_amount: { type: 'amount', required: false },
      currency: { type: 'currency', required: true },
      line_order: { type: 'integer', required: false },
      service_start: { type: 'date', required: false },
      service_end: { type: 'date', required: false },
      airline: { type: 'string', required: false },
      flight_number: { type: 'string', required: false },
      departure_airport: { type: 'string', required: false },
      arrival_airport: { type: 'string', required: false },
      departure_time: { type: 'string', required: false },
      arrival_time: { type: 'string', required: false },
      checkin_baggage_kg: { type: 'amount', required: false },
      hand_carry_baggage_kg: { type: 'amount', required: false },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  Booking: {
    tableName: 'Bookings',
    idField: 'booking_id',
    prefix: 'BOOKING',
    yearBased: true,
    statusField: 'status',
    fields: {
      booking_id: { type: 'id', required: true },
      quotation_id: { type: 'id', required: false, references: 'Quotation' },
      client_id: { type: 'id', required: true, references: 'Client' },
      contact_id: { type: 'id', required: false, references: 'Contact' },
      departure_id: { type: 'id', required: false, references: 'Departure' },
      booking_date: { type: 'date', required: true },
      travel_start: { type: 'date', required: false },
      travel_end: { type: 'date', required: false },
      destination: { type: 'string', required: false },
      pax_count: { type: 'integer', required: false },
      currency: { type: 'currency', required: true },
      client_total: { type: 'amount', required: true },
      supplier_cost_total: { type: 'amount', required: false },
      assigned_to: { type: 'string', required: false },
      status: { type: 'enum', required: true },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  BookingTraveler: {
    tableName: 'Booking Travelers',
    idField: 'booking_traveler_id',
    prefix: 'BOOKING_TRAVELER',
    yearBased: true,
    uniqueFields: [['booking_id', 'traveler_id']],
    fields: {
      booking_traveler_id: { type: 'id', required: true },
      booking_id: { type: 'id', required: true, references: 'Booking' },
      traveler_id: { type: 'id', required: true, references: 'Traveler' },
      is_primary: { type: 'boolean', required: true },
      traveler_role: { type: 'string', required: false },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  BookingItem: {
    tableName: 'Booking Items',
    idField: 'booking_item_id',
    prefix: 'BOOKING_ITEM',
    yearBased: true,
    statusField: 'status',
    fields: {
      booking_item_id: { type: 'id', required: true },
      booking_id: { type: 'id', required: true, references: 'Booking' },
      quotation_item_id: { type: 'id', required: false, references: 'QuotationItem' },
      service_type: { type: 'enum', required: true, allowed: ['Flight', 'Hotel', 'Transfer', 'Tour', 'Tour Package', 'Land Arrangement', 'Ticket', 'Other'] },
      supplier_id: { type: 'id', required: false, references: 'Supplier' },
      description: { type: 'string', required: true },
      service_start: { type: 'date', required: false },
      service_end: { type: 'date', required: false },
      quantity: { type: 'amount', required: true },
      supplier_cost: { type: 'amount', required: false },
      selling_price: { type: 'amount', required: false },
      currency: { type: 'currency', required: true },
      airline: { type: 'string', required: false },
      flight_number: { type: 'string', required: false },
      departure_airport: { type: 'string', required: false },
      arrival_airport: { type: 'string', required: false },
      departure_time: { type: 'string', required: false },
      arrival_time: { type: 'string', required: false },
      checkin_baggage_kg: { type: 'amount', required: false },
      hand_carry_baggage_kg: { type: 'amount', required: false },
      supplier_reference: { type: 'string', required: false },
      status: { type: 'enum', required: true, allowed: ['Draft', 'Pending Confirmation', 'Confirmed', 'Cancelled', 'Completed'] },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  Departure: {
    tableName: 'Departures',
    idField: 'departure_id',
    prefix: 'DEPARTURE',
    yearBased: true,
    statusField: 'status',
    fields: {
      departure_id: { type: 'id', required: true },
      name: { type: 'string', required: true },
      destination: { type: 'string', required: true },
      departure_type: { type: 'string', required: true },
      start_date: { type: 'date', required: true },
      end_date: { type: 'date', required: false },
      capacity: { type: 'integer', required: false },
      readiness_percent: { type: 'percentage', required: true },
      assigned_to: { type: 'string', required: false },
      status: { type: 'enum', required: true },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  Supplier: {
    tableName: 'Suppliers',
    idField: 'supplier_id',
    prefix: 'SUPPLIER',
    yearBased: false,
    statusField: 'status',
    uniqueFields: [['display_name']],
    fields: {
      supplier_id: { type: 'id', required: true },
      supplier_type: { type: 'string', required: true },
      legal_name: { type: 'string', required: true },
      display_name: { type: 'string', required: true },
      country: { type: 'string', required: false },
      primary_email: { type: 'email', required: false },
      payment_terms: { type: 'string', required: false },
      status: { type: 'enum', required: true },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  Invoice: {
    tableName: 'Invoices',
    idField: 'invoice_id',
    prefix: 'INVOICE',
    yearBased: true,
    statusField: 'status',
    uniqueFields: [['invoice_number']],
    fields: {
      invoice_id: { type: 'id', required: true },
      invoice_number: { type: 'string', required: true, immutable: true },
      booking_id: { type: 'id', required: false, references: 'Booking' },
      client_id: { type: 'id', required: true, references: 'Client' },
      contact_id: { type: 'id', required: false, references: 'Contact' },
      invoice_date: { type: 'date', required: true },
      due_date: { type: 'date', required: false },
      currency: { type: 'currency', required: true },
      subtotal: { type: 'amount', required: true },
      discount_total: { type: 'amount', required: true },
      fees_total: { type: 'amount', required: true },
      tax_total: { type: 'amount', required: true },
      total: { type: 'amount', required: true },
      amount_paid: { type: 'amount', required: true },
      balance_due: { type: 'amount', required: true },
      status: { type: 'enum', required: true },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  InvoiceItem: {
    tableName: 'Invoice Items',
    idField: 'invoice_item_id',
    prefix: 'INVOICE_ITEM',
    yearBased: true,
    fields: {
      invoice_item_id: { type: 'id', required: true },
      invoice_id: { type: 'id', required: true, references: 'Invoice' },
      booking_item_id: { type: 'id', required: false, references: 'BookingItem' },
      booking_id: { type: 'id', required: false, references: 'Booking' },
      description: { type: 'string', required: true },
      quantity: { type: 'amount', required: true },
      unit_price: { type: 'amount', required: true },
      amount: { type: 'amount', required: true },
      currency: { type: 'currency', required: true },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  Payment: {
    tableName: 'Payments',
    idField: 'payment_id',
    prefix: 'PAYMENT',
    yearBased: true,
    statusField: 'status',
    fields: {
      payment_id: { type: 'id', required: true },
      payment_direction: { type: 'enum', required: true, allowed: ['FROM_CLIENT', 'TO_SUPPLIER'] },
      invoice_id: { type: 'id', required: false, references: 'Invoice' },
      booking_id: { type: 'id', required: false, references: 'Booking' },
      client_id: { type: 'id', required: false, references: 'Client' },
      supplier_id: { type: 'id', required: false, references: 'Supplier' },
      supplier_booking_id: { type: 'id', required: false, references: 'SupplierBooking' },
      payment_date: { type: 'date', required: true },
      amount: { type: 'amount', required: true },
      currency: { type: 'currency', required: true },
      invoice_currency: { type: 'currency', required: false },
      invoice_amount: { type: 'amount', required: false },
      exchange_rate: { type: 'rate', required: false },
      exchange_rate_source: { type: 'string', required: false },
      exchange_rate_date: { type: 'date', required: false },
      method: { type: 'string', required: true },
      reference: { type: 'string', required: false },
      status: { type: 'enum', required: true },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  Document: {
    tableName: 'Documents',
    idField: 'document_id',
    prefix: 'DOCUMENT',
    yearBased: true,
    statusField: 'status',
    fields: {
      document_id: { type: 'id', required: true },
      external_file_id: { type: 'string', required: true },
      file_url: { type: 'string', required: false },
      file_name: { type: 'string', required: true },
      source_type: { type: 'enum', required: true, allowed: ['WMIT', 'SUPPLIER', 'TOUR_OPERATOR', 'AIRLINE', 'HOTEL', 'CLIENT', 'UNKNOWN'] },
      source_name: { type: 'string', required: false },
      related_entity_type: { type: 'string', required: false },
      related_entity_id: { type: 'id', required: false },
      document_type: { type: 'enum', required: true, allowed: ['WMIT_QUOTATION', 'WMIT_INVOICE', 'WMIT_VOUCHER', 'SUPPLIER_QUOTATION', 'SUPPLIER_TARIFF', 'TOUR_OPERATOR_VOUCHER', 'TOUR_OPERATOR_MEMO', 'AIRLINE_TICKET', 'HOTEL_VOUCHER', 'UNKNOWN'] },
      extraction_status: { type: 'enum', required: true, allowed: ['NOT_PROCESSED', 'EXTRACTED', 'FAILED'] },
      extraction_confidence: { type: 'percentage', required: false },
      status: { type: 'enum', required: true, allowed: ['Received', 'Classified', 'Needs Review', 'Matched', 'Archived'] },
      received_at: { type: 'datetime', required: false },
      processed_at: { type: 'datetime', required: false },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    },
    polymorphicReferences: [
      { typeField: 'related_entity_type', idField: 'related_entity_id', allowedTypes: ['Client', 'Traveler', 'Booking', 'BookingItem', 'Quotation', 'Supplier', 'SupplierBooking', 'Invoice', 'Departure'] }
    ]
  },
  SupplierTariff: {
    tableName: 'Supplier Tariffs',
    idField: 'supplier_tariff_id',
    prefix: 'SUPPLIER_TARIFF',
    yearBased: true,
    statusField: 'status',
    fields: {
      supplier_tariff_id: { type: 'id', required: true },
      supplier_id: { type: 'id', required: true, references: 'Supplier' },
      source_document_id: { type: 'id', required: false, references: 'Document' },
      destination: { type: 'string', required: false },
      package_name: { type: 'string', required: false },
      duration: { type: 'string', required: false },
      hotel: { type: 'string', required: false },
      room_type: { type: 'string', required: false },
      validity_start: { type: 'date', required: false },
      validity_end: { type: 'date', required: false },
      minimum_pax: { type: 'integer', required: false },
      maximum_pax: { type: 'integer', required: false },
      adult_rate: { type: 'amount', required: false },
      child_rate: { type: 'amount', required: false },
      single_supplement: { type: 'amount', required: false },
      peak_season_period: { type: 'string', required: false },
      surcharge: { type: 'amount', required: false },
      child_policy: { type: 'string', required: false },
      meal_inclusion: { type: 'string', required: false },
      optional_tour_surcharge: { type: 'amount', required: false },
      land_only_rate: { type: 'amount', required: false },
      currency: { type: 'currency', required: false },
      inclusions: { type: 'string', required: false },
      exclusions: { type: 'string', required: false },
      cancellation_terms: { type: 'string', required: false },
      review_status: { type: 'enum', required: true, allowed: ['Needs Review', 'Approved', 'Rejected'] },
       status: { type: 'enum', required: true, allowed: ['Draft', 'Needs Review', 'Approved', 'Expired', 'Archived'] },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  SupplierBooking: {
    tableName: 'Supplier Bookings',
    idField: 'supplier_booking_id',
    prefix: 'SUPPLIER_BOOKING',
    yearBased: true,
    statusField: 'status',
    fields: {
      supplier_booking_id: { type: 'id', required: true },
      supplier_id: { type: 'id', required: true, references: 'Supplier' },
      booking_id: { type: 'id', required: false, references: 'Booking' },
      supplier_reference: { type: 'string', required: false },
      service_description: { type: 'string', required: true },
      supplier_cost: { type: 'amount', required: false },
      currency: { type: 'currency', required: false },
      deposit: { type: 'amount', required: false },
      balance: { type: 'amount', required: false },
      deposit_due_date: { type: 'date', required: false },
      final_payment_due_date: { type: 'date', required: false },
      confirmation_date: { type: 'date', required: false },
       status: { type: 'enum', required: true, allowed: ['Draft', 'Requested', 'Pending Confirmation', 'Confirmed', 'Cancelled', 'Completed'] },
      confirmation_document_id: { type: 'id', required: false, references: 'Document' },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  SupplierBookingItem: {
    tableName: 'Supplier Booking Items',
    idField: 'supplier_booking_item_id',
    prefix: 'SUPPLIER_BOOKING_ITEM',
    yearBased: true,
    uniqueFields: [['supplier_booking_id', 'booking_item_id']],
    fields: {
      supplier_booking_item_id: { type: 'id', required: true },
      supplier_booking_id: { type: 'id', required: true, references: 'SupplierBooking' },
      booking_item_id: { type: 'id', required: true, references: 'BookingItem' },
      allocated_supplier_cost: { type: 'amount', required: false },
      currency: { type: 'currency', required: false },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  InvoiceBooking: {
    tableName: 'Invoice Bookings',
    idField: 'invoice_booking_id',
    prefix: 'INVOICE_BOOKING',
    yearBased: true,
    uniqueFields: [['invoice_id', 'booking_id']],
    fields: {
      invoice_booking_id: { type: 'id', required: true },
      invoice_id: { type: 'id', required: true, references: 'Invoice' },
      booking_id: { type: 'id', required: true, references: 'Booking' },
      relationship_type: { type: 'string', required: false },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    }
  },
  DocumentLink: {
    tableName: 'Document Links',
    idField: 'document_link_id',
    prefix: 'DOCUMENT_LINK',
    yearBased: true,
    uniqueFields: [['document_id', 'related_entity_type', 'related_entity_id']],
    fields: {
      document_link_id: { type: 'id', required: true },
      document_id: { type: 'id', required: true, references: 'Document' },
      related_entity_type: { type: 'string', required: true },
      related_entity_id: { type: 'id', required: true },
      relationship_type: { type: 'string', required: false },
      notes: { type: 'string', required: false },
      ...COMMON_AUDIT_FIELDS
    },
    polymorphicReferences: [
      { typeField: 'related_entity_type', idField: 'related_entity_id', allowedTypes: ['Client', 'Traveler', 'Quotation', 'Booking', 'BookingItem', 'Supplier', 'SupplierBooking', 'Invoice', 'Departure'] }
    ]
  },
  Task: {
    tableName: 'Tasks',
    idField: 'task_id',
    prefix: 'TASK',
    yearBased: true,
    statusField: 'status',
    fields: {
      task_id: { type: 'id', required: true },
      related_type: { type: 'enum', required: false },
      related_id: { type: 'id', required: false },
      title: { type: 'string', required: true },
      description: { type: 'string', required: false },
      priority: { type: 'enum', required: true },
      assigned_to: { type: 'string', required: false },
      due_at: { type: 'datetime', required: false },
      status: { type: 'enum', required: true },
      ...COMMON_AUDIT_FIELDS
    },
    polymorphicReferences: [
      { typeField: 'related_type', idField: 'related_id', allowedTypes: OPERATIONAL_ENTITY_TYPES }
    ]
  }
};

const SCHEMA_DEFINITION = {
  schemaVersion: SCHEMA_VERSION,
  storage: 'Google Sheets tables with header rows; IDs are stable text values',
  entities: SCHEMA
};

function getEntitySchema(entityType) {
  const definition = SCHEMA[entityType];
  if (!definition) {
    throw new Error('Unknown WMIT entity type: ' + entityType);
  }
  return definition;
}

module.exports = { SCHEMA_VERSION, SCHEMA, SCHEMA_DEFINITION, getEntitySchema };
