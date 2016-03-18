'use strict'
var fsWatch = require("node-watch");
var users = require("./config/users.json");
var clients = require("./config/clients.json");
var fs = require('fs');

var topicRule = new RegExp(/^[\w\d]+(\/[\w\d]+){1,20}$/);
var checker = {
  userTopicPermission : function (username, topic) {
    if (topicRule.test(topic)) {
      var clientIdFromTopic = topic.split("/")[0];
      var foundClient = clients.filter(function (c) {
          return c.id == clientIdFromTopic
        });
      if (foundClient.length == 1) {
        if (foundClient[0].allowedUsers.filter(function (u) {
            return (username == u)
          }).length == 1) {
          return true;
        }
      }
    }
    return false;
  },
  authenticate : function (username, password) {
    var foundUser = users.filter(function (u) {
        return (u.username == username) && (u.password == password)
      });
    if (foundUser.length == 1) {
      return true;
    } else {
      return false;
    }
  },
  certPrivate : fs.readFileSync('cert/key.pem'),
  certPublic : fs.readFileSync('cert/cert.pem')
};

fsWatch("cert/key.pem", function (filename) {
  console.log(filename, " changed.");
  checker.certPrivate = fs.readFileSync('cert/key.pem');
});

fsWatch("cert/cert.pem", function (filename) {
  console.log(filename, " changed.");
  checker.certPublic = fs.readFileSync('cert/cert.pem');
});

module.exports = checker;
