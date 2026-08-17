'use strict';

const COMMON_FIELDS = Object.freeze([
  'client', 'passenger', 'traveler', 'pax_count',
  'destination', 'origin', 'travel_start', 'travel_end', 'duration',
  'airline', 'flight_number', 'departure_airport', 'arrival_airport',
  'departure_datetime', 'arrival_datetime', 'terminal',
  'hotel_name', 'hotel_address', 'check_in', 'check_out', 'room_type',
  'share_type', 'room_count', 'rooming', 'occupants', 'room_number',
  'occupancy_count', 'service_type', 'service_description',
  'supplier', 'supplier_reference', 'invoice_number', 'quotation_reference',
  'day', 'date', 'city', 'activity',
  'meal_plan', 'hotel', 'currency', 'unit_price', 'quantity', 'amount',
  'discount', 'tax', 'commission', 'deposit', 'balance', 'due_date',
  'validity', 'minimum_pax', 'inclusions', 'exclusions', 'optional_services',
  'cancellation_terms', 'payment_terms', 'contact_name', 'phone', 'email',
  'emergency_contact', 'package', 'peak_season_period', 'single_supplement',
  'child_policy', 'land_only_rate'
]);

module.exports = { COMMON_FIELDS };
