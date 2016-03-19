'use strict'
var storeDb = require("./storeDb.js");
var dateFormat = require("date-format");
var config = require("./config/config.json");
var storeTopics = require("./config/storeTopics.json");
var level = require("level");
var aedesPersistencelevel = require("aedes-persistence-level");
var fsWatch = require("node-watch");
var clients = require("./config/clients.json");
var users = require("./config/users.json");
var checker = require("./checker.js");
var cleanup = require("./cleanup.js");
var squel = require("squel");

/**
 * Aedes INIT
 */

var aedes = require("aedes")({
    persistence : aedesPersistencelevel(level(config.broker.persistence.dbPath)),
    heartbeatInterval : config.broker.heartbeatInterval
  });

/**
 * TCP stream
 */
var tcpServer = require("net").createServer(aedes.handle);
tcpServer.listen(config.ports.tcp);

/**
 * TCP TLS stream
 */
var tls = require('tls');

var tlsOptions = {
  key : checker.certPrivate,
  cert : checker.certPublic
};

var tlsServer = tls.createServer(tlsOptions, function (stream) {
    aedes.handle(stream);
  });
tlsServer.listen(config.ports.tcptls);

/**
 * WS stream
 */
var websocket = require("websocket-stream");
var wsServer = websocket.createServer({
    server : config.hostname,
    port : config.ports.ws
  }, aedes.handle);

/**
 * Secure WS stream
 */
var https = require('https');
var wssServer = https.createServer(tlsOptions);
var wss = websocket.createServer({
    server : wssServer
  }, aedes.handle);
wssServer.listen(config.ports.wss);

/**
 * Aedes functions
 */
aedes.authenticate = function (client, username, password, cb) {
  if (checker.authenticate(username, password)) {
    client.username = username;
    return cb(null, true);
  } else {
    cb(null, false);
  }
}

aedes.authorizePublish = function (client, packet, cb) {
  if (checker.userTopicPermission(client.username, packet.topic)) {
    return cb(null);
  } else {
    console.log("publish denied");
    cb(new Error("publish denied"));
  }
}

aedes.authorizeSubscribe = function (client, packet, cb) {
  if (checker.userTopicPermission(client.username, packet.topic)) {
    console.log("subscribed", client.id, packet.topic);
    return cb(null, packet);
  } else {
    console.log("subscribe denied");
    cb(new Error("subscribe denied"));
  }
}

aedes.on("client", function (client) {
  console.log("client connected:", client.id);
});

aedes.on("clientDisconnect", function (client) {
  console.log("client disconnected:", client.id);
});

aedes.on("publish", function (packet, client) {
  console.log("published", packet.topic, packet.payload.toString());
});

/**
 * STORE Topics
 */
function storeTopic(topic, payload) {
  var topicParts = topic.split("/");
  var iq = squel.insert()
    .into("store")
    .set("client_id", topicParts[0])
    .set("created", dateFormat(new Date()))
    .set("source", topicParts.slice(1).join("/"))
    .set("value", payload.toString())
    .toParam();
  storeDb.pool.query(iq.text, iq.values, function (err, result) {
    if (err) {
      console.error(err)
      throw err;
    }
    console.log("DB inserted, record_id=" + result.insertId);
  });
}

storeTopics.forEach(function (topicName) {
  console.log("store topic registered", topicName);
  aedes.subscribe(topicName, function (packet, cb) {
    storeTopic(packet.topic, packet.payload);
    cb();
  });
});

/**
 * File watchers
 */
fsWatch("config/clients.json", function (filename) {
  console.log(filename, " changed.");
  delete require.cache[require.resolve("./config/clients.json")];
  clients = require("./config/clients.json");
});

fsWatch("config/users.json", function (filename) {
  console.log(filename, " changed.");
  delete require.cache[require.resolve("./config/users.json")];
  users = require("./config/users.json");
});

fsWatch("config/storeTopics.json", function (filename) {
  var oldTopicsList = require("./config/storeTopics.json");
  console.log(filename, " changed.");
  delete require.cache[require.resolve("./config/storeTopics.json")];
  storeTopics = require("./config/storeTopics.json");

  var newTopics = storeTopics.filter(function (x) {
      return oldTopicsList.indexOf(x) < 0
    });
  var deletedTopics = oldTopicsList.filter(function (x) {
      return storeTopics.indexOf(x) < 0
    });

  newTopics.forEach(function (topicName) {
    console.log("store topic registered", topicName);
    aedes.subscribe(topicName, callStoreTopic);
  });
  deletedTopics.forEach(function (topicName) {
    aedes.unsubscribe(topicName, callStoreTopic);
    console.log("store topic unregistered", topicName);
  });
});

function callStoreTopic(packet, cb) {
  storeTopic(packet.topic, packet.payload);
  cb();
}

/**
 * Data API
 */
var dataapi = require("./dataapi.js")({
    port : config.ports.dataapi,
    broker : aedes
  });
dataapi.start();

/**
 * Cleanup
 */
cleanup(function () {
  console.log("doing cleanup");
  dataapi.close();
  aedes.close();
  tcpServer.close();
  tlsServer.close();
  wsServer.close();
  storeDb.close();
  wssServer.close();
});
console.log("server ready");
