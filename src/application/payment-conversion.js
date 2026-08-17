(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WmitPaymentConversion = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Portable integer arithmetic for Apps Script and the local runtime.
  var RATE_SCALE = 1000000;

  function minor(value) {
    var text = String(value === undefined || value === null ? '' : value).trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) throw new Error('Payment amounts must use a non-negative amount with up to two decimal places.');
    var parts = text.split('.');
    return Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0') || '0');
  }

  function rate(value) {
    var text = String(value === undefined || value === null ? '' : value).trim();
    if (!/^\d+(?:\.\d{1,6})?$/.test(text) || Number(text) <= 0) throw new Error('The conversion rate must be a positive number with up to six decimal places.');
    var parts = text.split('.');
    return Number(parts[0]) * RATE_SCALE + Number((parts[1] || '').padEnd(6, '0') || '0');
  }

  function convertPaymentToInvoiceCurrency(paymentAmount, conversionRate) {
    var paymentMinor = minor(paymentAmount);
    var rateScaled = rate(conversionRate);
    var numerator = paymentMinor * RATE_SCALE;
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(rateScaled)) throw new Error('The payment is too large for exact conversion in this local prototype.');
    return Math.round(numerator / rateScaled);
  }

  function preparePayment(input) {
    var value = input || {};
    var paymentCurrency = value.payment_currency || value.currency;
    var invoiceCurrency = value.invoice_currency;
    var sameCurrency = paymentCurrency === invoiceCurrency;
    var conversionRate = sameCurrency ? 1 : value.exchange_rate;
    var invoiceAmountMinor = sameCurrency ? minor(value.amount) : convertPaymentToInvoiceCurrency(value.amount, conversionRate);
    return {
      payment_currency: paymentCurrency,
      invoice_currency: invoiceCurrency,
      payment_amount_minor: minor(value.amount),
      invoice_amount_minor: invoiceAmountMinor,
      exchange_rate: sameCurrency ? 1 : Number(conversionRate),
      exchange_rate_source: sameCurrency ? 'Same currency' : (value.exchange_rate_source || 'BDO Forex Selling Rate + 1.0 - manual snapshot'),
      exchange_rate_date: value.exchange_rate_date || value.payment_date
    };
  }

  return { minor: minor, rate: rate, convertPaymentToInvoiceCurrency: convertPaymentToInvoiceCurrency, preparePayment: preparePayment };
}));
