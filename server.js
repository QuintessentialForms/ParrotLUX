"use strict";

let ipAddress, displayAddress;
let dirPrefix = "";
if( global.inAndroidApp !== true ) {
	
    const { networkInterfaces, type } = require("os");

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

    ipAddress = results.find( ip => ip.indexOf( "192" ) === 0 );
    if( ! ipAddress ) {
        ipAddress = "127.0.0.1";
        console.log( "Local network IP address not found. App will only be accessible on this device." );
    }

    displayAddress = ipAddress;
    ipAddress = "0.0.0.0";

} else {
    
	displayAddress = ipAddress = "127.0.0.1";
    dirPrefix = __dirname + "/";

}

const http = require( 'http' );
const https = require( 'https' );
const fss = require( "fs" );
const host = ipAddress;
const port = 6789;

//console.log( "TODO: serve generic resource names" );

const server = http.createServer(
    async ( request , response ) => {
        request.on( 'error' , err => console.error( "Request error: " , err ) );
        response.on( 'error' , err => console.error( "Response error: " , err ) );

        const { method , url , headers } = request;
        if( method === 'GET' ) {

            //console.log( "incoming connection: " , method , url , headers );
            
            if( url === '/' ) {
                response.writeHead( 200 , { 'Content-Type': 'text/html' } );
                const indexFile = fss.readFileSync( dirPrefix + 'res/canvas.html' );
                response.write( indexFile );
                //response.end( '\n<!-- Comment at end of file! -->\n' );
                response.end();
            }
            if( url.indexOf( '/store.js' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'text/javascript' } );
                const codeFile = fss.readFileSync( dirPrefix + 'res/store.js' );
                response.write( codeFile );
                response.end();
            }
            if( url.indexOf( '/canvas.js' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'text/javascript' } );
                const codeFile = fss.readFileSync( dirPrefix + 'res/canvas.js' );
                response.write( codeFile );
                response.end();
            }
            if( url.indexOf( '/canvas.css' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'text/css' } );
                const styleFile = fss.readFileSync( dirPrefix + 'res/canvas.css' );
                response.write( styleFile );
                response.end();
            }

            if( url.indexOf( '/icon/' ) === 0 ) {
                //get icon name
                const iconName = url.substring( "/icon/".length, url.length - ".png".length );
                let okay = (/[\w-]+/gmi).test( iconName ),
                    ref = "res/img/ui/icon-" + iconName + ".png";
                if( okay ) { okay = fss.existsSync( dirPrefix + ref ); }
                if( okay ) {
                    const iconImageFile = fss.readFileSync( dirPrefix + ref );
                    response.writeHead( 200 , { 'Content-Type': 'image/png' } );
                    response.write( iconImageFile );
                    response.end();
                } else {
                    response.writeHead( 404 , { 'Content-Type': 'text/plain' } );
                    response.end( 'Icon name not recognized.' );
                }
            }
            if( url.indexOf( '/apiFlows/' ) === 0 ) {
                const apiFlowName = url.substring( "/apiFlows/".length, url.length - ".json".length );
                let okay = (/[\w-]+/gmi).test( apiFlowName ),
                    ref = "res/apiFlows/" + apiFlowName + ".json";
                if( okay ) { okay = fss.existsSync( dirPrefix + ref ); }
                if( okay ) {
                    const apiFlowJSONFile = fss.readFileSync( dirPrefix + ref );
                    response.writeHead( 200 , { 'Content-Type': 'text/json' } );
                    response.write( apiFlowJSONFile );
                    response.end();
                } else {
                    response.writeHead( 404 , { 'Content-Type': 'text/plain' } );
                    response.end( 'APIFlow filename not recognized.' );
                }
            }
            if( url === '/apiFlows' ) {
                const apiFlowsFolder = "res/apiFlows";
                const apiFileNames = [];
                const directory = fss.readdirSync( apiFlowsFolder, { withFileTypes: true } );
                for( const fileEntry of directory ) {
                    if( fileEntry.isFile() && ! fileEntry.isDirectory() ) {
                        apiFileNames.push( `"${fileEntry.name}"` );
                    }
                }
                response.writeHead( 200, { 'Content-Type': 'text/json' } );
                response.write( "[" + apiFileNames.join(",") + "]" );
                response.end();
            }
            if( url === '/brushes' ) {
                const brushesFolder = "res/brushes";
                const brushFiles = [];
                const directory = fss.readdirSync( brushesFolder, { withFileTypes: true } );
                for( const fileEntry of directory ) {
                    if( fileEntry.isFile() && ! fileEntry.isDirectory() ) {
                        brushFiles.push( fss.readFileSync( dirPrefix + "res/brushes/" + fileEntry.name ) );
                    }
                }
                response.writeHead( 200, { 'Content-Type': 'text/json' } );
                response.write( "[" + brushFiles.join(",") + "]" );
                response.end();
            }

            if( url.indexOf( '/paper.png' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'image/png' } );
                const paperFile = fss.readFileSync( dirPrefix + 'res/paper.png' );
                response.write( paperFile );
                response.end();
            }
            if( url.indexOf( '/ColorWheel-Base.png' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'image/png' } );
                const paperFile = fss.readFileSync( dirPrefix + 'res/ColorWheel-Base.png' );
                response.write( paperFile );
                response.end();
            }
            if( url.indexOf( '/ColorWheel-Slots-Lower.png' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'image/png' } );
                const paperFile = fss.readFileSync( dirPrefix + 'res/ColorWheel-Slots-Lower.png' );
                response.write( paperFile );
                response.end();
            }
            if( url.indexOf( '/ColorWheel-Slots-Upper.png' ) === 0 ) {
                response.writeHead( 200 , { 'Content-Type': 'image/png' } );
                const paperFile = fss.readFileSync( dirPrefix + 'res/ColorWheel-Slots-Upper.png' );
                response.write( paperFile );
                response.end();
            }
            if( url.indexOf( '/res/img/brushes/' ) === 0 ) {
                //Warning! This is EXTREMELY unsafe!!! Rewrite ASAP. :-|
                //Brush images should be DataURIs in JSON, just make the converter already
                const filename = url.replace( '/res/img/brushes/', '' );
                response.writeHead( 200 , { 'Content-Type': 'image/png' } );
                const brushtipFile = fss.readFileSync( dirPrefix + 'res/img/brushes/' + filename );
                response.write( brushtipFile );
                response.end();
            }

            if( url === '/favicon.ico' ) {
                response.writeHead( 404 , { 'Content-Type': 'text/plain' } );
                response.end( 'There is no favicon. Stop asking.' );
            }

        }
        if( method === 'POST' ) {
            //console.log( "incoming POST connection: " , method , url , headers );
            if( url === '/test-log' ) {
                let body = [];
                request.on( "data", d => body.push( d ) );
                request.on( "end", () => {
                    const bodyString = body.join("");
                    console.log( "Got incoming example post request: " );
                    console.log( request.headers );
                    console.log( bodyString );
                    response.writeHead( 200 , {
                        'Content-Type': 'application/json',
                        //'Content-Length': Buffer.byteLength( responseString ) //added this on a whim, might break stuff!
                    } );
                    response.end( '{"success":"Logged request to console."}' );
                } );
            }
            if( url === '/api' ) {
                let body = [];
                request.on( "data", d => body.push( d ) )
                request.on( "end", () => {
                    const bodyString = body.join("");
                    //console.log( "Incoming post ended. Got body: ", bodyString.substring(0,10) + "... " + bodyString.length + " characters." );
                    let json;
                    try {
                        json = JSON.parse( bodyString );
                    } catch (e) {
                        response.writeHead( 400, { 'Content-Type': 'text/plain' } );
                        response.end( "Bad JSON." );
                    }
                    if( json ) {
                        //console.log( "Received JSON POST from client." );
                        //let's make the post request to the URL given in the data.

                        const apiString = (json.method === "POST") ? JSON.stringify( json.apiData ) : null;

                        //set up our options
                        const requestOptions = {
                            /* host: '127.0.0.1', //json.host
                            port: '7860', //json.port
                            path: '/sdapi/v1/txt2img', //json.path */
                            //host: json.host,
                            host: json.host === "localhost" ? ipAddress : json.host,
                            port: json.port,
                            path: json.path,
                            method: json.method === "POST" ? 'POST' : 'GET',
                        }
                        if( ! json.port ) delete requestOptions.port;

                        if( json.method === "POST" && json.dataFormat === "JSON" ) {
                            requestOptions.headers = {
                                'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength( apiString ),
                            }
                        }

                        let responseData = [];

                        if( requestOptions.method === "POST" ) {
                            let postBinary;
                            if( json.dataFormat === "FORM" ) {
                                /* 

                                headers
                                    Content-Type: multipart/form-data; boundary=----WebKitFormBoundaryePkpFF7tjBAqx29L

                                body
                                    Content-Disposition: form-data; name="uploadedfile"; filename="hello.o"\r\n
                                    Content-Type: application/x-object\r\n
                                    \r\n... contents of file goes here ...
                                    \r\n------WebKitFormBoundaryePkpFF7tjBAqx29L--\r\n

                                */

                                //console.log( "Posting Form Data" );
                                const boundary = "-----------------------------81138824917293574772476006527"
                                const preBuffers = [
                                        //Buffer.from( `Content-Type: multipart/form-data; boundary=${boundary}\n\n--${boundary}` ),
                                        Buffer.from( `--${boundary}` ),
                                    ],
                                    buffers = [];
                                for( const key in json.apiData ) {
                                    const value = json.apiData[ key ];
                                    //console.log( "Adding to multipart data key: ", key );
                                    if( typeof value !== "object" ) {
                                        if( json.convertDataImages === true && typeof value === "string" && /^data:image\//.test( value ) ) {

                                            const [ , mimeType, base64encoded ] = value.match( 'data:(image/.*);base64,(.*)' );

                                            let filename = `Tempera - upload ${parseInt(Math.random() * 9999999999)}`;
                                            if( mimeType === "image/png" ) filename += ".png";
                                            if( mimeType === "image/jpg" || mimeType == "image/jpeg" ) filename += ".jpg";
                                            if( mimeType === "image/webp" ) filename += ".webp";

                                            const multipartDataLine = `\r\nContent-Disposition: form-data; name="${key}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;

                                            //console.log( "Adding multipart dataline: ", multipartDataLine );

                                            buffers.push( Buffer.from( multipartDataLine ) );
                                            buffers.push( Buffer.from( base64encoded, "base64" ) );
                                            buffers.push( Buffer.from( `\r\n--${boundary}` ) );

                                            //alternatively: buffers.push( Buffer.from( `\n--${boundary}` ) );

                                        }
                                        else if( typeof value === "string" ) {
                                            const multipartDataLine = `\r\nContent-Disposition: form-data; name="${key}"\r\nContent-Type: text/plain;charset=utf-8\r\n\r\n${value}`;
                                            buffers.push( Buffer.from( multipartDataLine ) );
                                            buffers.push( Buffer.from( `\r\n--${boundary}`) );
                                        }
                                        else if( typeof value === "number" ) {
                                            const multipartDataLine = `\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}`;
                                            buffers.push( Buffer.from( multipartDataLine ) );
                                            buffers.push( Buffer.from( `\r\n--${boundary}`) );
                                        }
                                    }
                                }

                                buffers.push( Buffer.from( `--\n\n` ) ); //two more dashes after last boundary

                                const compiledBuffersArray = preBuffers.concat( buffers );
                                const streamableBuffer = Buffer.concat( compiledBuffersArray );
                                //const readableStream = Readable.from( streamableBuffer );

                                requestOptions.headers = {
                                    "Accept": "*/*",
                                    //Accept-Language: en-US,en;q=0.5
                                    //Accept-Encoding: gzip, deflate, br
                                    "Content-Type": "multipart/form-data; boundary=" + boundary,
                                    //"Content-Type": "multipart/form-data"
                                    "Content-Length": streamableBuffer.length
                                };

                                for( const headerKey in json.headerData ) {
                                    requestOptions.headers[ headerKey ] = json.headerData[ headerKey ];
                                }

                                //console.log( "Headers: ", requestOptions.headers )

                                postBinary = streamableBuffer;

                                //readableStream.pipe( postRequest );

                            }

                            console.log( json );
                            console.log( `${( json.protocol === "https" ? "https" : "http" )}://${requestOptions.host}${requestOptions.port ? `:${json.port}` : ""}${json.path}` );
                            console.log( requestOptions );

                            const postRequest = ( json.protocol === "https" ? https : http ).request(
                                `${( json.protocol === "https" ? "https" : "http" )}://${requestOptions.host}${requestOptions.port ? `:${json.port}` : ""}${json.path}`,
                                requestOptions,
                                forwardedResponse => {
                                    //forwardedResponse.setEncoding( "utf8" );
                                    forwardedResponse.on( "data", chunk => {
                                        //console.log( "Got reflected response data." );
                                        responseData.push( chunk );
                                    } );
                                    forwardedResponse.on( 'end', () => {
                                        //console.log( "Responding with reflected POST: ", responseData );
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
    
                            postRequest.on( "error", e => console.error( "Forwarded POST request error ",  e ) );
                            console.log( "Reflecting client POST." );
                            if( json.dataFormat === "JSON" ) {
                                //console.log( "Writing APIString: " + apiString.substring( 0, 20 ) + "..." );
                                postRequest.write( apiString );
                            }
                            if( json.dataFormat === "FORM" ) {
                                //console.log( "Streaming post data now...", postBinary.toString() );
                                postRequest.write( postBinary );
                            }
                            //console.log( "Finished posting any relevant data." );
                            postRequest.end();    
                        }
                        
                        if( requestOptions.method === "GET" ) {
                            //console.log( "GETing with options ", JSON.stringify( postOptions ) );
    
                            let getRequest;

                            try {
                                getRequest = ( json.protocol === "https" ? https : http ).request(
                                    `${( json.protocol === "https" ? "https" : "http" )}://${requestOptions.host}${requestOptions.port ? `:${json.port}` : ""}${json.path}`,
                                    requestOptions,
                                    forwardedResponse => {
                                        //forwardedResponse.setEncoding( "utf8" );
                                        forwardedResponse.on( "data", chunk => {
                                            //console.log( "Got reflected response data." );
                                            responseData.push( chunk );
                                        } );
                                        forwardedResponse.on( 'end', () => {
                                            console.log( "Responding with reflected GET..." );
                                            const responseString = responseData.join( "" );
                                            //console.log( "Reflected response: ", responseString );
                                            let responseIsJSON = false;
                                            try { JSON.parse( responseString ); responseIsJSON = true; } catch( e ) {}
                                            if( responseIsJSON ) {
                                                response.writeHead( 200 , {
                                                    'Content-Type': 'application/json',
                                                    //'Content-Length': Buffer.byteLength( responseString ) //added this on a whim, might break stuff!
                                                } );
                                                response.end( responseString );
                                            } else {
                                                //let's assume for now it's an image/png???
                                                response.writeHead( 200 , {
                                                    'Content-Type': 'image/png',
                                                    //'Content-Length': Buffer.byteLength( responseString ) //added this on a whim, might break stuff!
                                                } );
                                                let responseBinary = Buffer.concat( responseData );
                                                response.end( responseBinary );
                                            }
                                        })
                                    }
                                );
                            } catch( e ) {
                                response.writeHead( 404 , {
                                    'Content-Type': 'application/json',
                                    //'Content-Length': Buffer.byteLength( responseString ) //added this on a whim, might break stuff!
                                } );
                                response.end( '{"error":"Tempera server.js reports bad request."}' );
                            }
    
                            if( getRequest ) {
                                getRequest.on( "error", e => console.error( "Forwarded GET request error ",  e ) );
                                console.log( "Reflecting client GET." );
                                getRequest.end();  
                            }  
                        }
                    }
                } )
            }
        }
    }
);

server.listen( { host , port },
    () => {
        console.log( `Server listening on http://${displayAddress}:${port}/` );
    }
);