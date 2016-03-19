'use strict'

var chai = require('chai');
var sinon = require('sinon');
chai.config.includeStack = true;

var expect = chai.expect;

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

/*
 * returns a new openMetrics logger
 * and spy on the _get calls
 */
var getNewLogger = function() {
  var openMetrics = require('../open-metrics.js')('http://localhost:3000');
  expect(getEventQueueLength(openMetrics)).to.be.equal(0);
  openMetrics._get = sinon.spy();
  return openMetrics;
};

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


describe("Loading", function () {
  it("should load the librairy", function () {
    var openMetrics = require('../open-metrics.js')('http://localhost:3000');
    expect(openMetrics).to.not.be.undefined;
    expect(getEventQueueLength(openMetrics)).to.be.equal(0);
  });
});

describe("events get logs successfully", function () {
  var uid = 'foo';
  it("Logs one event directly", function () {
    var openMetrics = getNewLogger();
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
    var openMetrics = getNewLogger();
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
