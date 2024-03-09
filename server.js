"use strict";

const { networkInterfaces } = require("os");
const nets = networkInterfaces();
const results = [];

for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
        // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
        // 'IPv4' is in Node <= 17, from 18 it's a number 4 or 6
        const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
        if (net.family === familyV4Value && !net.internal) {
            results.push( net.address );
        }
    }
}

let ipAddress = results.find( ip => ip.indexOf( "192" ) === 0 );
if( ! ipAddress ) {
    ipAddress = "127.0.0.1";
    console.log( "Local network IP address not found. App will only be accessible on this device." );
}

const http = require( 'http' );
const fs = require( 'fs/promises' );
const host = ipAddress;
const port = 6789;

console.log( "TODO: serve generic resource names" );

const server = http.createServer(
    async ( request , response ) => {
        request.on( 'error' , err => console.error( "Request error: " , err ) );
        response.on( 'error' , err => console.error( "Response error: " , err ) );

        const { method , url , headers } = request;
        if( method === 'GET' ) {

            console.log( "incoming connection: " , method , url , headers );
            
            if( url === '/' ) {
                response.writeHead( 200 , { 'Content-Type': 'text/html' } );
                const indexFile = await fs.readFile( 'res/canvas.html' );
                response.write( indexFile );
                //response.end( '\n<!-- Comment at end of file! -->\n' );
                response.end();
            }
            if( url.indexOf( '/canvas.js' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'text/javascript' } );
                const codeFile = await fs.readFile( 'res/canvas.js' );
                response.write( codeFile );
                response.end();
            }
            if( url.indexOf( '/canvas.css' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'text/css' } );
                const styleFile = await fs.readFile( 'res/canvas.css' );
                response.write( styleFile );
                response.end();
            }

            if( url.indexOf( '/paper.png' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'image/png' } );
                const paperFile = await fs.readFile( 'res/paper.png' );
                response.write( paperFile );
                response.end();
            }
            if( url.indexOf( '/ColorWheel-Base.png' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'image/png' } );
                const paperFile = await fs.readFile( 'res/ColorWheel-Base.png' );
                response.write( paperFile );
                response.end();
            }
            if( url.indexOf( '/ColorWheel-Slots-Lower.png' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'image/png' } );
                const paperFile = await fs.readFile( 'res/ColorWheel-Slots-Lower.png' );
                response.write( paperFile );
                response.end();
            }
            if( url.indexOf( '/ColorWheel-Slots-Upper.png' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'image/png' } );
                const paperFile = await fs.readFile( 'res/ColorWheel-Slots-Upper.png' );
                response.write( paperFile );
                response.end();
            }
            if( url.indexOf( '/res/img/brushes/tip-pencil01.png' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'image/png' } );
                const paperFile = await fs.readFile( 'res/img/brushes/tip-pencil01.png' );
                response.write( paperFile );
                response.end();
            }

            if( url === '/favicon.ico' ) {
                response.writeHead( 404 , { 'Content-Type': 'text/plain' } );
                response.end( 'There is no favicon. Stop asking.' );
            }

        }
        if( method === 'POST' ) {
            console.log( "incoming POST connection: " , method , url , headers );
            if( url === '/api' ) {
                let body = [];
                request.on( "data", d => body.push( d ) )
                request.on( "end", () => {
                    const bodyString = body.join("");
                    console.log( "Incoming post ended. Got body: ", bodyString.substring(0,10) + "... " + bodyString.length + " characters." );
                    let json;
                    try {
                        json = JSON.parse( bodyString );
                    } catch (e) {
                        response.writeHead( 400, { 'Content-Type': 'text/plain' } );
                        response.end( "Bad JSON." );
                    }
                    if( json ) {
                        console.log( "Received JSON POST from client." );
                        //let's make the post request to the URL given in the data.

                        const apiString = JSON.stringify( json.apiData );

                        //set up our options
                        const postOptions = {
                            /* host: '127.0.0.1', //json.host
                            port: '7860', //json.port
                            path: '/sdapi/v1/txt2img', //json.path */
                            //host: json.host,
                            host: ipAddress,
                            port: json.port,
                            path: json.path,
                            method: 'POST', //json.method
                            headers: {
                                'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength( apiString )
                            }
                        }

                        let responseData = [];

                        console.log( "POSTing with options ", JSON.stringify( postOptions ) );
                        console.log( "POSTing to URL, ", `http://${ipAddress}:${json.port}${json.path}` );

                        const postRequest = http.request(
                            //"http://127.0.0.1:7860/sdapi/v1/txt2img", //json.url
                            //json.url,
                            `http://${ipAddress}:${json.port}${json.path}`,
                            postOptions,
                            forwardedResponse => {
                                forwardedResponse.setEncoding( "utf8" );
                                forwardedResponse.on( "data", chunk => {
                                    //console.log( "Got reflected response data." );
                                    responseData.push( chunk );
                                } );
                                forwardedResponse.on( 'end', () => {
                                    console.log( "Sending client reflected POST." );
                                    const responseString = responseData.join( "" );
                                    //console.log( "Reflected response: ", responseString );
                                    response.writeHead( 200 , {
                                        'Content-Type': 'application/json',
                                        //'Content-Length': Buffer.byteLength( responseString ) //added this on a whim, might break stuff!
                                    } );
                                    response.end( responseString );
                                })
                            }
                        );

                        postRequest.on( "error", e => console.error( "Forwarded post request error ",  e ) );
                        console.log( "Sending reflected POST..." );
                        postRequest.write( apiString );
                        postRequest.end();
                        
                    }
                } )
            }
        }
    }
);

server.listen( { host , port },
    () => {
        console.log( `Server listening on http://${host}:${port}/` );
    }
);