var mysql = require('mysql');
var config = require("./config/config.json");

var pool = mysql.createPool({
		connectionLimit : 20,
		host : config.store.host,
		user : config.store.user,
		password : config.store.password,
		database : config.store.database,
		debug : false
	});

exports.pool = pool;

exports.close = function () {
	pool.end();
}
