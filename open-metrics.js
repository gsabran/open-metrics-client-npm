'use strict';

var http = require('http');
var URL = require('url');

module.exports = function(openMetricServerAddress) {
  // keep track of the mapping between user id and session id
  usedSessionIds = {};

    
  /*
   * make it easier to use the api without directly managing session ids
   * and by passing user ids directly
   */
  var abstractIdentification = function(identification) {
    var userId = identification.userId;
    if (!identification.sessionId && !userId)
      throw new Error('a id must be specidied to identify the session or the user');
    if (!identification.sessionId) {
      var existingSessionId = usedSessionIds[userId];
      if (existingSessionId)
        identification.sessionId = existingSessionId;
      else {
        // automatically creates a session id and attach it to the user ID
        var makeRandomId = function() {
          // generate a random string
          var text = "";
          var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
          for (var i=0; i < 10; i++)
            text += possible.charAt(Math.floor(Math.random() * possible.length));
          return text;
        };
        var sessionId = makeRandomId();
        identification.sessionId = sessionId;
        usedSessionIds[userId] = sessionId;
        OpenMetrics.setUserId(sessionId, userId);
      }
    }
    return identification.sessionId;
  };

  var OpenMetrics = {
    
    /*
     * Below are functions that can be called directly
     */


    /*
     * log an event, with optional properties
     * @properties should be a hash of propertyName: propertyValue
     * @options specify logging options (see https://github.com/gsabran/open-metrics)
     */
    logEvent: function(identification, eventName, properties, options) {
      var sessionId = abstractIdentification(identification);

      var queue = OpenMetrics._eventsQueue;
      queue.events[sessionId] = queue.events[sessionId] || {events: []};
      queue.events[sessionId].events.push({name: eventName, props: properties, ts: Date.now(), options: options});
      queue._size += 1;
      OpenMetrics._pingFlush();
    },

    /*
     * set the user Id to be use, probably to match the id on your product
     * @options specify logging options (see https://github.com/gsabran/open-metrics)
     */
    setUserId: function(sessionId, userId, options) {
      if (!sessionId)
        throw new Error('a id must be specidied to identify the session');

      OpenMetrics._get('/v1/setUserId', {uid: userId, options: options}, sessionId);
      usedSessionIds[userId] = sessionId;
    },
    
    /*
     * attach any number of properties to the current user
     * @properties should be a hash of propertyName: propertyValue
     * @options specify logging options (see https://github.com/gsabran/open-metrics)
     */
    setUserProperties: function(identification, properties, options) {
      var sessionId = abstractIdentification(identification);

      OpenMetrics._get('/v1/setUserProps', {props: properties, options: options}, sessionId);
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
