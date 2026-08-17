'use strict';

// Supplier-specific pilot adapter. The generic application knows only the
// adapter contract; Bangkok-specific extraction remains isolated here.
const { extractBangkokTravelServicesDocx } = require('../document-intelligence/bangkok-travel-services');

function createBangkokTariffUploadAdapter() {
  return {
    key: 'BANGKOK_TRAVEL_SERVICES_DOCX',
    accepts(input) {
      return Boolean(input && input.file_name && /\.docx$/i.test(String(input.file_name)));
    },
    extract(filePath) {
      return extractBangkokTravelServicesDocx(filePath);
    }
  };
}

module.exports = { createBangkokTariffUploadAdapter };
