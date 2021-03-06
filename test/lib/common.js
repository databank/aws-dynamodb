fs = require('fs')
async = require('async')
assert = require('assert')
yaml = require('js-yaml')
$tableName = 'test_hash_range'


/* try with dynamodb-local
var dynalite = require('dynalite'),
dynaliteServer = dynalite({ createTableMs: 50, db: require('memdown')})
dynaliteServer.listen(8000, function(err) {
	if (err) throw err
})
*/

var AWS = require('aws-sdk')
//AWS.config.logger = console;
AWS.config.maxRetries = 20;


const DynamodbFactory = require('../../lib/dynamodb')
//const DynamodbFactory = require('../../dist/dynamodb-node.js')
//import { DynamodbFactory } from '../../dist/dynamodb-node.min.js'

DynamodbFactory.config( {
	stringset_parse_as_set: false,
	numberset_parse_as_set: false,
	empty_string_replace_as: ""
} );



// test against local version
//DynamoDB = new DynamodbFactory( new AWS.DynamoDB({endpoint: 'http://localhost:8000', "accessKeyId": "myKeyId", "secretAccessKey": "secret", "region": "us-east-1" }))

// test against online demo version
// DynamoDB = new DynamodbFactory( new AWS.DynamoDB({endpoint: 'https://djaorxfotj9hr.cloudfront.net/v1/dynamodb', "accessKeyId": "myKeyId", "secretAccessKey": "secret", "region": "eu-central-1" }))
// DynamoDB = new DynamodbFactory({ endpoint: 'https://djaorxfotj9hr.cloudfront.net/v1/dynamodb', accessKeyId: "myKeyId", secretAccessKey: "secret", region: "eu-central-1" })

// test against AWS DynamoDB
DynamoDB = new DynamodbFactory({
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	region: process.env.AWS_REGION,
})






DynamoDB.schema({
	TableName: 'test_hash',
	KeySchema: [
		{
			AttributeName: "hash",
			KeyType: "HASH"
		}
	]
})
DynamoDB.schema([{
	TableName: 'test_hash_range',
	KeySchema: [
		{
			AttributeName: "hash",
			KeyType: "HASH"
		},
		{
			AttributeName: "range",
			KeyType: "RANGE"
		}
	]
}])


DynamoDB.on('error', function(op, error, payload ) {
	//console.log(op,error,JSON.stringify(payload))
})
DynamoDB.on('beforeRequest', function(op, payload ) {
	//console.log("--------------------------------")
	//console.log(op,payload)
})

query_handler = function( idx, yml ) {
	return function(done) {
		if (yml.Tests.query[idx].log === true)
			global.DDBSQL = true
		else
			global.DDBSQL = false

		var ddb = DynamoDB
		if (yml.Tests.query[idx].explain === true)
			ddb = ddb.explain()


		var err;
		var data;
		var dataItem;



			async.waterfall([


				// beforequery
				function( cb ) {
					if (!yml.Tests.query[idx].hasOwnProperty('beforeQuery'))
						return cb()

					ddb.query( yml.Tests.query[idx].beforeQuery, function( ) {
						cb()
					})
				},
				// before sleep
				function( cb ) {
					if (!yml.Tests.query[idx].hasOwnProperty('beforeSleep'))
						return cb()

					setTimeout(cb, yml.Tests.query[idx].beforeSleep )
				},


				// actual query
				function( cb ) {
					ddb.query( yml.Tests.query[idx].query, function(sqlerr, sqldata ) {
						err = sqlerr;
						data = sqldata;
						cb()
					})
				},

				// sleep
				function( cb ) {
					if (!yml.Tests.query[idx].hasOwnProperty('sleep'))
						return cb()

					setTimeout(cb, yml.Tests.query[idx].sleep )
				},


				function(cb) {
					if (! yml.Tests.query[idx].hasOwnProperty('dataItem'))
						return cb()

					var dt = DynamoDB.table(yml.Tests.query[idx].dataItem.table)
					Object.keys(yml.Tests.query[idx].dataItem.item).map(function(k) {
						dt.where(k).eq(yml.Tests.query[idx].dataItem.item[k])
					})
					dt.get(function(err, new_data ) {
						if (err)
							throw err

						dataItem = new_data
						cb()
					})

				},
			], function() {




				if (yml.Tests.query[idx].shouldFail) {
					if (err) {
						if (!(yml.Tests.query[idx].validations || []).length)
							return done()

						yml.Tests.query[idx].validations.forEach(function(el) {
							var left = eval( el.key );
							if ( el.sortKeyAsArray === true ) {
								left = left.sort(function(a,b) {
									return a > b ? 1 : -1;
								})
							}
							assert.deepEqual( left , eval( el.value ))
						})
						done()
					}
				} else {
					if (err)
						throw err

					if (yml.Tests.query[idx].log === true) {
						console.log("data=", JSON.stringify(data, null, "\t"))
						if (dataItem) console.log("dataItem=", JSON.stringify(dataItem, null, "\t"))
					}

					if (yml.Tests.query[idx].results)
						assert.equal(data.length, yml.Tests.query[idx].results)

					if (yml.Tests.query[idx].validations) {
						yml.Tests.query[idx].validations.forEach(function(el) {
							var left = eval( el.key );
							if ( el.sortKeyAsArray === true ) {
								left = left.sort(function(a,b) {
									return a > b ? 1 : -1;
								})
							}
							assert.deepEqual( left , eval( el.value ))
						})
					}
					done()
				}
			})




	}
}

before_test = function(data) {
	return function(done) {
		async.each(data, function(q, cb ) {
			DynamoDB.query(q, cb )
		}, function(err) {
			if (err)
				throw err

			done()
		})
	}
}

run_test = function(test_name, yml_file ) {

	describe(test_name, function () {
		var yml = yaml.safeLoad(fs.readFileSync(yml_file, 'utf8'))
		before(before_test(yml.Prepare.Data))
		// beforeEach

		yml.Tests.query.forEach(function(v,k) {
			it(yml.Tests.query[k].title || yml.Tests.query[k].query, query_handler(k, yml ) )

		})
	})
}
