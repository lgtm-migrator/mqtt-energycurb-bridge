var curbAccessToken
var curbRefreshToken

var clientId
var clientSecret

var locations
var smartThings

var request = require('request')
var io = require('socket.io-client')

function getCurbToken(userInfo, st, refreshTokenCb) {
    console.log('Logging in to Curb')
    smartThings = st
    clientId = userInfo.curb_client_id
    clientSecret = userInfo.curb_client_secret

    request.post({
            url: 'https://energycurb.auth0.com/oauth/token',
            form: {
                grant_type: 'password',
                audience: 'app.energycurb.com/api',
                scope: 'offline_access',
                username: userInfo.username,
                password: userInfo.password,
                client_id: userInfo.curb_client_id,
                client_secret: userInfo.curb_client_secret
            }
        },
        function(err, res, body) {
            if (res && res.statusCode == 200) {
                //console.log("Response: " + body);

                curbAccessToken = JSON.parse(body).access_token
                curbRefreshToken = JSON.parse(body).refresh_token

                //console.log("Curb Access Token: " + curbAccessToken);
                //console.log("Curb Refresh Token: " + curbRefreshToken);

                refreshTokenCb(curbRefreshToken)

                setInterval(function() { refreshToken(function() {}) }, 20 * 60 * 60 * 1000)

                getCurbLocations()
            } else {
                console.log('Something Went Wrong while submitting form data to Curb ' + res.statusCode + ': ' + body)
                if (err) throw err
            }
        })

}


function refreshToken(refreshCompleteCb) {
    console.log('Refreshing Curb auth')

    request.post({
            url: 'https://energycurb.auth0.com/oauth/token',
            form: {
                grant_type: 'refresh_token',
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: curbRefreshToken
            }
        },
        function(err, res, body) {
            if (res && res.statusCode == 200) {
                //console.log("Response: " + body);
                curbAccessToken = JSON.parse(body).access_token

                //console.log("Curb Access Token: " + curbAccessToken);
                refreshCompleteCb()
            } else {
                console.log('Something Went Wrong while getting refresh token ' + res.statusCode + ': ' + body)
                if (err) throw err
            }
        })
}

function useCurbToken(token, id, secret, st) {
    curbRefreshToken = token
    clientId = id
    clientSecret = secret
    smartThings = st

    refreshToken(getCurbLocations)
    setInterval(function() { refreshToken(function() {}) }, 20 * 60 * 60 * 1000)
}

function getCurbLocations() {
    console.log('Requesting Curb location info')

    request
        .get('https://app.energycurb.com/api/locations',
            function(error, response, body) {
                if (response && response.statusCode == 200) {
                    console.log('Curb Location Info: ' + body)
                    locations = JSON.parse(body)

                    getHistoricalUsage()
                    setInterval(function() { getHistoricalUsage() }, 5 * 60 * 1000)
                    setTimeout(function() { connectToLiveData() }, 10 * 1000)
                } else {
                    console.log('Something went wrong getting location info')
                    console.log(response.statusCode)
                    console.log(error)
                }
            })
        .auth(null, null, true, curbAccessToken)
}


function connectToLiveData() {
    var socket = io('https://app.energycurb.com/api/circuit-data', {
        reconnect: true,
        transports: ['websocket']
    })

    socket.on('connect', function() {
        console.log('Connected to socket.io, authenticating')
        socket.emit('authenticate', { token: curbAccessToken }, function(data) { console.log('Auth Ack: ' + data) })
    })
    socket.on('authorized',
        function() {
            console.log('Authorized for socket.io, suscribing to live data')
            socket.emit('subscribe', locations[0].id)
        })
    socket.on('data',
            function(data) {
                json = JSON.stringify(data)
                    //console.log("Got Live Data: " + json);
                smartThings.send('data', json)
            })
        //socket.on('disconnect', connectToLiveData);
}

function getHistoricalUsage() {
    var url = 'https://app.energycurb.com/api/historical/' + locations[0].id + '/24h/5m'

    //console.log("Getting historical data: " + url);

    request
        .get(url,
            function(error, response, body) {
                if (response && response.statusCode == 200) {
                    //console.log("Got historical data: " + body);
                    smartThings.send('historical', body)
                } else {
                    console.log('Something went wrong getting historical data')
                    if (response) { console.log(response.statusCode) }
                    if (error) { console.log(error) }
                }
            })
        .auth(null, null, true, curbAccessToken)
}

module.exports.connect = getCurbToken
module.exports.reconnect = useCurbToken