'use strict'
var express = require('express');
var https = require('https');
var bodyParser = require('body-parser');
var jwt = require('jsonwebtoken');
var squel = require("squel");
var checker = require("./checker.js");
var storeDb = require("./storeDb.js");
var _ = require("underscore");

module.exports = Dataapi;

function Dataapi(opts) {
	if (!(this instanceof Dataapi)) {
		return new Dataapi(opts)
	}
	this._server;
	this._eapp = express();
	this._port = opts.port || 81;
	this._broker = opts.broker;
}

Dataapi.prototype.start = function () {

	setupApi(this);

	this._server = https.createServer({
			key : checker.certPrivate,
			cert : checker.certPublic
		}, this._eapp);

	this._server.listen(this._port);
}

Dataapi.prototype.close = function () {
	this._server.close();
}

function setupApi(that) {
	that._eapp.use(bodyParser.urlencoded({
			extended : false
		}));
	/**
	 * API authentication
	 */
	that._eapp.post('/authenticate', function (req, res) {
		if (checker.authenticate(req.body.username, req.body.password)) {
			var token = jwt.sign({
					username : req.body.username
				}, checker.certPrivate, {
					algorithm : 'RS256',
					expiresIn : 86400
				}, function (token) {
					res.json({
						success : true,
						message : 'Enjoy your token!',
						token : token
					});
				});
		} else {
			res.json({
				success : false,
				message : 'Authentication failed.'
			});
		}
	});

	/**
	 * API template
	 */
	that._eapp.use(function (req, res, next) {
		var token = req.body.token || req.query.token || req.headers['x-access-token'];
		if (token) {
			jwt.verify(token, checker.certPublic, function (err, decoded) {
				if (err) {
					return res.json({
						success : false,
						message : 'Failed to authenticate token.'
					});
				} else {
					req.username = decoded.username;
					next();
				}
			});
		} else {
			return res.status(403).send({
				success : false,
				message : 'No token provided.'
			});
		}
	});

	/**
	 * API topic-based functions
	 */
	that._eapp.use('/:topic/*', function (req, res, next) {
		var topic = req.params.topic;
		topic = topic.replace("|", "/");
		if (checker.userTopicPermission(req.username, topic)) {
			var topicParts = topic.split("/");
			req.topic = topic;
			req.clientId = topicParts[0];
			req.source = topicParts.slice(1).join("/");
			next();
		} else {
			return res.status(403).send({
				success : false,
				message : 'Not authorized.'
			});
		}
	});
	/**
	 * API function 1
	 * TOPIC FORMAT -> client_id|level1|level2|levelN
	 */
	that._eapp.post('/:topic/:dir(first|last)/:count/:type(second|minute|hour|day|week|month|quater|year|record)', function (req, res) {
		if (!isNaN(req.params.count)) {
			var sq = squel.select()
				.from("store")
				.field("record_id")
				.field("DATE_FORMAT(created, '%Y-%m-%d %H:%i:%s')", "created")
				.field("value")
				.where("client_id = ?", req.clientId)
				.where("source = ?", req.source);

			switch (req.params.type) {
			case "record":
				sq.limit(parseInt(req.params.count));
				break;
			default:
				if (req.params.dir == "last") {
					sq.where("created >= (NOW() - INTERVAL ? " + req.params.type + " )", parseInt(req.params.count));
				} else {
					sq.where("created <= ((SELECT MIN(created) FROM store) + INTERVAL ? " + req.params.type + " )", parseInt(req.params.count));
				}
			}
			sq.order("record_id", (req.params.dir == "first"));
			sq = sq.toParam();

			storeDb.pool.query(sq.text, sq.values,
				function (err, result) {
				if (err) {
					console.error(err);
					throw err;
				}
				res.json(result);
				res.end();
			});
		} else {
			res.json({
				status : "wrong request format"
			});
			res.end();
		}
	});

	/**
	 * API function 2
	 */
	that._eapp.post('/:topic/from/:dfrom/to/:dto', function (req, res) {
		var dateRule = new RegExp(/^\d\d\d\d\-\d\d?\-\d\d?( \d\d?:\d\d?:\d\d?)?$/);
		if (dateRule.test(req.params.dfrom) && dateRule.test(req.params.dto)) {
			var sq = squel.select()
				.from("store")
				.field("record_id")
				.field("DATE_FORMAT(created, '%Y-%m-%d %H:%i:%s')", "created")
				.field("value")
				.where("client_id = ?", req.clientId)
				.where("source = ?", req.source)
				.where("created between ? and ?", req.params.dfrom, req.params.dto)
				.order("record_id");

			sq = sq.toParam();
			storeDb.pool.query(sq.text, sq.values,
				function (err, result, fields) {
				if (err) {
					console.error(err);
					throw err;
				}
				res.json(result);
				res.end();
			});
		} else {
			res.json({
				status : "wrong request format"
			});
			res.end();
		}
	});

	/**
	 * API function 3
	 */
	that._eapp.post('/:topic/publish/:payload', function (req, res) {
		if (that._broker) {
			that._broker.publish({
				topic : req.topic,
				payload : new Buffer(req.params.payload)
			}, function () {
				res.json({
					topic : req.topic,
					payload : req.params.payload,
					status : "published"
				});
				res.end();
			});
		} else {
			res.json({
				status : "no broker configured"
			});
			res.end();
		}
	});
}
