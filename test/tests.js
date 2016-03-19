'use strict'

var chai = require('chai');
chai.config.includeStack = true;
var expect = chai.expect;
var sinon = require('sinon');
var PassThrough = require('stream').PassThrough;

/*
 * directly compute the total number of events in the queue
 * and make sure it's equal to _size
 */
var getEventQueueLength = function(openMetrics) {
  var length = 0;
  for (var sessionId in openMetrics._eventsQueue.events) {
    length += openMetrics._eventsQueue.events[sessionId].events.length;
  }
  expect(openMetrics._eventsQueue._size).to.be.equal(length);
  return length;
};

describe("Load librairy", function () {
  it("should load the librairy", function () {
    var openMetrics = require('../open-metrics.js')('http://localhost:3000');
    expect(openMetrics).to.not.be.undefined;
    expect(getEventQueueLength(openMetrics)).to.be.equal(0);
  });
});


describe("events get logs successfully", function () {
  var uid = 'foo';
  var openMetrics;

  /*
   * make sure the event logging request is made with the correct arguments
   */
  var testEventCall = function(requestArgs, ops) {
    expect(requestArgs[0]).to.be.equal('/v1/events');

    expect(requestArgs[1].events.length).to.be.equal(ops.eventsNumber);

    var event = requestArgs[1].events[0];
    expect(event.name).to.be.equal(ops.name);
    expect(event.props).to.be.deep.equal(ops.props);
    expect(event.options).to.be.deep.equal(ops.options);

    // importantly, the session id is the one created before
    expect(requestArgs[2]).to.be.equal(ops.sessionId);
  }

  // add a stub on _get
  beforeEach(function() {
    openMetrics = require('../open-metrics.js')('http://localhost:3000');
    expect(getEventQueueLength(openMetrics)).to.be.equal(0);
    openMetrics._get = sinon.spy();
  });

  it("Logs one event directly", function () {
    expect(getEventQueueLength(openMetrics)).to.be.equal(0);

    // first event should be sent directly
    openMetrics.logEvent({userId: uid}, 'pageView', {page: '/home'}, {active: false});
    expect(getEventQueueLength(openMetrics)).to.be.equal(0);

    // check the http calls
    expect(openMetrics._get.callCount).to.be.equal(2);
    
    // first call creates a session id and attach it to the user
    var firstCall = openMetrics._get.getCall(0).args;
    expect(firstCall[0]).to.be.equal('/v1/setUserId');
    expect(firstCall[1].uid).to.be.equal(uid);
    expect(firstCall[1].options.active).to.be.false;
    var sessionId = firstCall[2];
    expect(sessionId).not.to.be.undefined;

    // second call logs the event
    var secondCall = openMetrics._get.getCall(1).args;
    testEventCall(secondCall, {
      eventsNumber: 1,
      name: 'pageView',
      props: {page: '/home'},
      options: {active: false},
      sessionId: sessionId
    });
  });

  it("Logs one event directly and wait a bit before sending another request", function (done) {
    this.timeout(5000);
    openMetrics.logEvent({userId: 'foo'}, 'pageView', {page: '/home'}, {active: false});
    var sessionId = openMetrics._get.getCall(0).args[2];

    // then throttling should happen
    openMetrics.logEvent({userId: 'foo'}, 'pageView', {page: '/feed'}, {active: false});
    expect(getEventQueueLength(openMetrics)).to.be.equal(1);
    setTimeout(function() {
      expect(getEventQueueLength(openMetrics)).to.be.equal(0);

      // check http calls
      expect(openMetrics._get.callCount).to.be.equal(3);
      var lastEventCall = openMetrics._get.getCall(2).args;
      testEventCall(lastEventCall, {
        eventsNumber: 1,
        name: 'pageView',
        props: {page: '/feed'},
        options: {active: false},
        sessionId: sessionId
      });
      done();
    }, 4000);
  });
});

describe("user properties get logs successfully", function () {
  var uid = 'foo';
  var openMetrics;

  /*
   * make sure the properties logging request is made with the correct arguments
   */
  var testPropCall = function(requestArgs, ops) {
    expect(requestArgs[0]).to.be.equal('/v1/setUserProps');
    // test properties equality
    expect(requestArgs[1].props).to.not.be.undefined;
    expect(requestArgs[1].props).to.be.deep.equal(ops.props);
    // test options equality
    expect(requestArgs[1].options).to.be.deep.equal(ops.options);
    // test sessionId
    expect(requestArgs[2]).to.be.equal(ops.sessionId);
  }

  // add a stub on _get
  beforeEach(function() {
    openMetrics = require('../open-metrics.js')('http://localhost:3000');
    openMetrics._get = sinon.spy();
  });

  it("logs one property", function () {
    openMetrics.setUserProperties({userId: uid}, {name: 'Gui'}, {active: false});

    // check the http calls
    expect(openMetrics._get.callCount).to.be.equal(2);
    
    // first call creates a session id and attach it to the user
    var firstCall = openMetrics._get.getCall(0).args;
    expect(firstCall[0]).to.be.equal('/v1/setUserId');
    expect(firstCall[1].uid).to.be.equal(uid);
    expect(firstCall[1].options.active).to.be.false;
    var sessionId = firstCall[2];
    expect(sessionId).not.to.be.undefined;

    // second call logs the user properties
    var secondCall = openMetrics._get.getCall(1).args;
    testPropCall(secondCall, {
      props: {name: 'Gui'},
      options: {active: false},
      sessionId: sessionId
    });
  });

  it("logs one property without options", function () {
    openMetrics.setUserProperties({userId: uid}, {name: 'Gui'});
    var sessionId = openMetrics._get.getCall(0).args[2];
    
    var secondCall = openMetrics._get.getCall(1).args;
    testPropCall(secondCall, {
      props: {name: 'Gui'},
      sessionId: sessionId
    });
  });

  it("logs several property at once", function () {
    openMetrics.setUserProperties({userId: uid}, {name: 'Gui', type: 'admin'});
    var sessionId = openMetrics._get.getCall(0).args[2];
    
    var secondCall = openMetrics._get.getCall(1).args;
    testPropCall(secondCall, {
      props: {name: 'Gui', type: 'admin'},
      sessionId: sessionId
    });
  });

  it("also works with several calls", function () {
    openMetrics.setUserProperties({userId: uid}, {name: 'Gui'});
    openMetrics.setUserProperties({userId: uid}, {type: 'admin'});

    expect(openMetrics._get.callCount).to.be.equal(3);
    
    var sessionId = openMetrics._get.getCall(0).args[2];

    var secondCall = openMetrics._get.getCall(1).args;
    testPropCall(secondCall, {
      props: {name: 'Gui'},
      sessionId: sessionId
    });
    
    var thirdCall = openMetrics._get.getCall(2).args;
    testPropCall(thirdCall, {
      props: {type: 'admin'},
      sessionId: sessionId
    });
  });

  it("doesn't mix user ids", function () {
    var uid2 = '321';
    openMetrics.setUserProperties({userId: uid}, {name: 'Gui'});
    openMetrics.setUserProperties({userId: uid2}, {type: 'admin'});

    expect(openMetrics._get.callCount).to.be.equal(4);

    var sessionId1 = openMetrics._get.getCall(0).args[2];
    var sessionId2 = openMetrics._get.getCall(2).args[2];
    
    var secondCall = openMetrics._get.getCall(1).args;
    testPropCall(secondCall, {
      props: {name: 'Gui'},
      sessionId: sessionId1
    });
    
    var thirdCall = openMetrics._get.getCall(3).args;
    testPropCall(thirdCall, {
      props: {type: 'admin'},
      sessionId: sessionId2
    });
  });
});


describe("Authentication", function () {
  it("should fail if no user Id or session Id is provided", function () {
    var openMetrics = require('../open-metrics.js')('http://localhost:3000');

    expect(function() { openMetrics.logEvent({}, 'anonymousEvent') }).to.throw(Error);
    expect(function() { openMetrics.setUserProperties({}, {name: 'gui'}) }).to.throw(Error);
    expect(function() { openMetrics.setUserId(null, 'foo') }).to.throw(Error);
  });
});


describe("GET requests", function () {
  var http = require('http');
  var openMetrics;

  beforeEach(function() {
    openMetrics = require('../open-metrics.js')('http://localhost:3000');
    this.get = sinon.stub(http, 'get');
  });
   
  afterEach(function() {
    http.get.restore();
  });

  it("creates a request", function () {
    openMetrics._get('/v1/ping', {}, '123');

    expect(this.get.callCount).to.be.equal(1);
  });

  it("creates the correct request", function () {
    var payload = {type: 'important'};
    var sessionId = '123';
    openMetrics._get('/v1/ping', payload, sessionId);

    var requestArgs = this.get.getCall(0).args;
    payload.sessionId = sessionId;
    expect(requestArgs[0]).to.be.deep.equal({
      host: 'localhost',
      port: 3000,
      path: '/v1/ping?q='+JSON.stringify(payload),
    });
  });

  it("works with no port", function () {
    openMetrics = require('../open-metrics.js')('http://example.com');

    var payload = {type: 'important'};
    var sessionId = '123';
    openMetrics._get('/v1/ping', payload, sessionId);

    var requestArgs = this.get.getCall(0).args;
    payload.sessionId = sessionId;
    expect(requestArgs[0]).to.be.deep.equal({
      host: 'example.com',
      port: 80,
      path: '/v1/ping?q='+JSON.stringify(payload),
    });
  });

  it("call the callback on success with no error", function(done) {
    var response = new PassThrough();
    response.statusCode = 200;
    response.write('ok');
    response.end();

    var request = new PassThrough();
    this.get.callsArgWith(1, response).returns(request);

    var payload = {type: 'important'};
    var sessionId = '123';
    openMetrics._get('/v1/ping', payload, sessionId, function(e, res) {
      expect(e).to.be.null;
      expect(res).to.be.equal('ok');
      done();
    });
  });


  it("call the callback on error with error flag", function(done) {
    var response = new PassThrough();
    response.statusCode = 301;
    response.write('bug');
    response.end();

    var request = new PassThrough();
    this.get.callsArgWith(1, response).returns(request);

    var payload = {type: 'important'};
    var sessionId = '123';
    openMetrics._get('/v1/ping', payload, sessionId, function(e, res) {
      expect(e).to.be.true;
      expect(res).to.be.undefined;
      done();
    });
  });
});
