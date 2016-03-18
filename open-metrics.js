'use strict';

var http = require('http');
var URL = require('url');

module.exports = function(openMetricServerAddress) {
  var OpenMetrics = {
    
    /*
     * Below are functions that can be called directly
     */


    /*
     * log an event, with optional properties
     * @properties should be a hash of propertyName: propertyValue
     */
    logEvent: function(sessionId, eventName, properties) {
      if (!sessionId)
        throw new Error('a id must be specidied to identify the session');

      var queue = OpenMetrics._eventsQueue;
      queue.events[sessionId] = queue.events[sessionId] || {events: []};
      queue.events[sessionId].events.push({name: eventName, props: properties, ts: Date.now()});
      queue._size += 1;
      OpenMetrics._pingFlush();
    },

    /*
     * set the user Id to be use, probably to match the id on your product
     */
    setUserId: function(sessionId, userId) {
      if (!sessionId)
        throw new Error('a id must be specidied to identify the session');

      OpenMetrics._get('/v1/setUserId', {uid: userId}, sessionId);
    },
    
    /*
     * attach any number of properties to the current user
     * @properties should be a hash of propertyName: propertyValue
     */
    setUserProperties: function(sessionId, properties) {
      if (!sessionId)
        throw new Error('a id must be specidied to identify the session');

      OpenMetrics._get('/v1/setUserProps', {props: properties}, sessionId);
    },


    
    /*
     * Below are functions that are not made to be called directly
     */


    /*
     * a queue of events to be logged. We only make one request a second
     */
    _eventsQueue: {_size:0, events: {}},

    /*
     * make a simple POST request to the server
     * @callback is called when the request is done
     */
    _get: function(route, payload, sessionId, callback) {
      var location = URL.parse(openMetricServerAddress);
      payload.sessionId = sessionId;
      http.get({
        host: location.hostname,
        port: (location.port && parseInt(location.port)) || 80,
        path: route + '?q='+JSON.stringify(payload),
      }, function(res) {
        // Continuously update stream with data
        var body = '';
        res.on('data', function(d) {
          body += d;
        });
        res.on('end', function() {
          console.log('over status:', res.statusCode);
          console.log('body', body);
          if (res.statusCode == 200) {
            callback && callback();
          }
        });
      });
    },

    /*
     * last time the events have been logged
     */
    _lastTimeFlushed: null,

    /*
     * try to log pending events
     * if @flushAnyway, a request will be made no matter how recent is the last one
     */
    _pingFlush: function(flushAnyway) {
      var t = Date.now(),
        lastFlushed = OpenMetrics._lastTimeFlushed;
      var length = OpenMetrics._eventsQueue._size;

      // make sure we don't make requests too often
      if (!length || (!flushAnyway && lastFlushed && t - lastFlushed < 1000 && length < 10)) {
        return;
      }
      console.log('will _pingFlush', OpenMetrics._eventsQueue.events['123']);
      OpenMetrics._lastTimeFlushed = t;

      for (var sessionId in OpenMetrics._eventsQueue.events)
        OpenMetrics._get('/v1/events', {events: OpenMetrics._eventsQueue.events[sessionId].events}, sessionId);
      OpenMetrics._eventsQueue = {_size:0, events: {}};
    },
  };

  // regularly log events
  OpenMetrics._pingFlush();
  setInterval(OpenMetrics._pingFlush, 1000);
  return OpenMetrics;
};
