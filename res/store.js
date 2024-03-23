/*

    Store Usage:

    0. const { openStorage } = await access( "zip" );

    1. const store = await openStorage( databaseName );

    2. Store objects with a key and value:
        await store.set( "list", [ ... ] )

    3. Retrieve stored objects via 'is' value:
        await store.get( 'list' )
            -> { is: 'list', list: [...] }

    4. Detect whether an object 'is' value exists:
        await store.has( 'list' )
            -> true | false
    
    5. Delete via 'is' value:
        await store.delete( 'list' );

    6. Get list of all stored 'is' value keys:
        await store.getKeys()
            -> [ 'list', ... ]
    
    7. Reset / clear all stored 'is' keys in the database:
        await store.resetDatabase()
            -> store

    To delete a database:
        window.indexedDB.deleteDatabase( databaseName );

*/

const openStorage = databaseName => new Promise( resolve => {

    if( typeof databaseName !== 'string' ) throw 'store: openStorage( databaseName ) expected string';

    let database;

    const acquire = resolve => {
        const request = window.indexedDB.open( databaseName, 1 )
        request.onupgradeneeded = e => e.target.result.createObjectStore( databaseName, { keyPath: 'is' } );
        request.onsuccess = e => { 
            database = e.target.result; 
            database.onversionchange = () => database.close();
            resolve( methods );
        };
        request.onerror = e => resolve( false );
    }
    acquire( resolve );

    const run = ( { method, mode = "readonly", subject, onsuccess = () => true, onerror = () => false } ) =>
        new Promise( resolve => {

            const request = database.transaction( databaseName, mode ).objectStore( databaseName )[ method ]( subject );
            
            request.onerror = () => resolve( onerror( request.result ) );
            request.onsuccess = () => resolve( onsuccess( request.result ) );

        } );

    const methods = {
        set: ( key, value ) => run( { method:"put", subject: { is: key, value }, mode:"readwrite" } ),
        has: key => run( { method:"getKey", subject: key, onsuccess: r => !!r } ),
        delete: key => run( { method:"delete", subject: key, mode:"readwrite" } ),
        getKeys: () => run( { method:"getAllKeys", onsuccess: r => Array.from( r ) } ),
        get: key => run( { method:"get", subject: key, onsuccess: r => r.value, onerror: () => undefined } ),
        
        resetDatabase: () => new Promise( ( resolve ) => {
            const deletion = window.indexedDB.deleteDatabase( databaseName );
            deletion.onsuccess = () => acquire( resolve );
            deletion.onerror = () => resolve( false );
        } ),
    }
} );
