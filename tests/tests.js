var chai = require('chai');
var expect = chai.expect;

var OpenMetrics = require('open-metrics')('http://localhost:3000');
expect(OpenMetrics).to.not.be.undefined;
