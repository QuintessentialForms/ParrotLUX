/* 

  This needs so much debugging tho... :-|
  - blending pointilism gaps why??? :-(
  (fixed) - painting & blending on a transparent layer is sampling black on the brush's edge pixels
  (fixed) - layer controls (duplicate, delete) failed to reappear on selecting a layer, despite its border changing to white
  (fixed) - layer button disappears while dragging (reappeared on drop)
  (fixed) - mask controls failed to appear
  (fixed) - gen controls on open sometimes show .99999999999999999 etc instead of int
  (fixed) - paint operation failed to persist to layer (no update, maybe rect problem) (maybe fixed w/ NaN x||ing)
  (fixed) - blending has edges even on fully opaque layer
  (fixed) - clicking up/down arrows on slider often fails; tune sensitivity
  - need to save size per brush so I can easily switch between e.g. line brush & fill brush (copies of same base)
  (fixed)- there are no filters (hue/saturation/contrast)
  - there's no select/cut area. Have to paint instead of outlining to erase area.
  - no way to set layers to exact positions / rotations
  - lineart looks blocky / pixely when zoomed out. (Not doing subsampling.)
  (fixed)- cascade doesn't have img2img
  - there's no lora browser
  (fixed)- have to input settings again when switching from txt2img to img2img
  - have to input settings + choose api every time I start a new file
  - there's no batches generate and no gen history
  - accidentally hit back button deletes drawing with no way to recover!
  - flood fill with padding is really slow. tablet freezes for a second.
  - can't keep painting while waiting for generate, or writing prompt.
  - can't queue up multiple gens
  - can't interrupt current gen on mistake notice
  - brushes don't have texture
  (fixed chrome) - pen tablet input doesn't work on Windows or Linux. Should at least == mouse.
  (fixed) - asset browser is just 1 line tall on phone landscape mode
  - gen controls covered up on phone portrait mode

*/
const VERSION = 3;

const main = document.createElement( "div" ),
  underlayContainer = document.createElement( "div" ),
  uiContainer = document.createElement( "div" ),
  overlayContainer = document.createElement( "div" );
main.id = "main";
underlayContainer.id = "underlay";
uiContainer.id = "ui";
overlayContainer.id = "overlay";

/* const cnv = document.createElement( "canvas" ),
  ctx = cnv.getContext( "2d" );
cnv.id = "cnv"; */

const gnv = document.createElement( "canvas" ),
gl = gnv.getContext( "webgl2", { premultipliedAlpha: false, alpha: true } );
gnv.id = "gnv";

let W = 0, H = 0;
let currentImage = null,
  //currentArtCanvas = null,
  batchedLayers = new Set(),
  selectedLayer = null;
  //selectedPaintLayer = null,
  //selectedGenLayer = null;

const demoPoints = [];

const layersStack = {
  layers: []
}

const history = [],
  redoHistory = [];
function recordHistoryEntry( entry ) {
  history.push( entry );
  UI.addContext( "undo-available" );
  redoHistory.length = 0;
  UI.deleteContext( "redo-available" );
  if( history.length > uiSettings.maxUndoSteps ) {
    const entry = history.shift();
    entry.cleanup?.();
  }
}
function popUndoEntry() {
  history.pop(); 
  if( history.length === 0 ) {
    UI.deleteContext( "undo-available" );
  };
}
function clearUndoHistory() {
  for( const entry of history )
    entry.cleanup?.();
  history.length = 0;
  UI.deleteContext( "undo-available" );
  for( const entry of redoHistory )
    entry.cleanup?.();
  redoHistory.length = 0;
  UI.deleteContext( "redo-available" );
}
function undo() {
  if( history.length === 0 ) {
    UI.deleteContext( "undo-available" );
    return;
  };
  const entry = history.pop();
  entry.undo();
  redoHistory.push( entry );
  UI.addContext( "redo-available" );
  if( history.length === 0 ) {
    UI.deleteContext( "undo-available" );
  };
}
function redo() {
  if( redoHistory.length === 0 ) {
    UI.deleteContext( "redo-available" );
    return;
  };
  const entry = redoHistory.pop();
  entry.redo();
  history.push( entry );
  UI.addContext( "undo-available" );
  if( redoHistory.length === 0 ) {
    UI.deleteContext( "redo-available" );
  };
}

function updateAndMakeLayerFrame( layer ) {
  let currentFrame = layer.frames[ layer.currentFrameIndex ];
  if( ! currentFrame ) {
    currentFrame = makeLayerFrame( layer );
    layer.currentFrameIndex = layer.frames.push( currentFrame ) - 1;
    updateLayerFrame( layer, currentFrame );
    console.log( "added frame to layer" );
  } else {
    console.log( "Updated frame layer." );
    updateLayerFrame( layer, currentFrame );
  }
}

function makeLayerFrame( layer ) {
  let frameType = layer.layerType;

  const frame = { frameType, timeIndex: uiSettings.currentTimeSeekIndex };

  return frame;
}

function updateLayerFrame( layer, frame, initGenerativeFrame = false ) {
  //frames store equidimensioned-ish visual data representations
  if( layer.layerType === "paint" ) {
    const { fullSizeURL, thumbnailURL, dotURL } = getLayerCanvasURLs( layer );
    frame.fullSizeURL = fullSizeURL;
    frame.thumbnailURL = thumbnailURL;
    frame.dotURL = dotURL;
  }
  if( layer.layerType === "pose" ) {
    frame.rig = JSON.parse( JSON.stringify( layer.rig ) );
  }
  if( layer.layerType === "generative" && initGenerativeFrame === true ) {
    frame.apiFlowName = layer.generativeSettings.apiFlowName;
    frame.generativeControls = {
      apiFlowName: JSON.parse( JSON.stringify( layer.generativeControls[ frame.apiFlowName ] ) )
    };
    //We won't change these URLs here. They aren't meant to change anyway.
    const { fullSizeURL, thumbnailURL, dotURL } = getLayerCanvasURLs( layer );
    frame.fullSizeURL = fullSizeURL;
    frame.thumbnailURL = thumbnailURL;
    frame.dotURL = dotURL;
  }
  if( layer.layerType === "text" ) {}
  if( layer.layerType === "group" ) {}
  if( layer.layerType === "filter" ) {}
  if( layer.layerType === "model" ) {}
}
function makePaintFrameFromGenerativeFrame( frame ) {
  return {
    frameType: "paint",
    timeIndex: frame.timeIndex,
    fullSizeURL: frame.fullSizeURL,
    thumbnailURL: frame.thumbnailURL,
    dotURL: frame.dotURL
  }
}

function getLayerCanvasURLs( layer ) {
  if( ! getLayerCanvasURLs.previewLayer ) {
    getLayerCanvasURLs.previewLayer = addCanvasLayer( "_temp" );
  }
  const fullSizeURL = layer.canvas.toDataURL( "png" );
  const previewLayer = getLayerCanvasURLs.previewLayer;
  const thumbnailSize = 84;
  //composeLayers( previewLayer, [layer], thumbnailSize / Math.max(layer.w,layer.h) );
  composeLayersGPU( previewLayer, [layer], thumbnailSize / Math.max(layer.w,layer.h) );
  const thumbnailURL = previewLayer.canvas.toDataURL( "png" );
  const dotSize = 8;
  //composeLayers( previewLayer, [layer], dotSize / Math.max(layer.w,layer.h) );
  composeLayersGPU( previewLayer, [layer], dotSize / Math.max(layer.w,layer.h) );
  const dotURL = previewLayer.canvas.toDataURL( "png" );
  return { fullSizeURL, thumbnailURL, dotURL };
}

async function guaranteeLayerHasImageFrame( layer ) {
  //flush pending lulls
  //if paint layer, check if has image frame
  //if not, make
  //...Not needed though IMO. Color adjust will use its own stored image.
}

function loadLayerFrame( layer, frame, flagTextureChanged=true ) {
  //Warning! If you're switching timeline frames, you NEED to save-update the current frame first, then load from storage. :-|
  //(Actually, you can check if your layer is in layersToUpdateFrames to see if it has updates pending.)
  if( layer.layerType === "paint" )
    return new Promise( r => {
      const img = new Image();
      img.src = frame.fullSizeURL;
      img.onload = () => {
        layer.context.clearRect( 0,0,layer.w,layer.h );
        layer.context.drawImage( img, 0, 0 );
        if( flagTextureChanged === true )
          flagLayerTextureChanged( layer, null, true );
      }
      img.src = frame.fullSizeURL;
    } )
}

const layersToUpdateFrames = new Set();
let lullTimer = null;
function updateFrameOnLull( layer ) {
  if( layer ) layersToUpdateFrames.add( layer );
  clearTimeout( lullTimer );
  lullTimer = setTimeout( updateFrameAfterLull, uiSettings.paintBusyTimeout );
}
function updateFrameAfterLull() {
  if( lullTimer !== null ) clearTimeout( lullTimer );
  lullTimer = null;
  const layer = [ ...layersToUpdateFrames ][ 0 ];
  if( ! layer ) return;
  layersToUpdateFrames.delete( layer );
  updateAndMakeLayerFrame( layer );
  if( layersToUpdateFrames.size > 0 ) updateFrameAfterLull();
}
function flushLayerUpdates() {
  while( layersToUpdateFrames.size > 0 )
    updateFrameAfterLull();
}

function makeFrameMergingFrameOntoFrame( topLayer, topFrame, lowerLayer, lowerFrame, respectOpacity=true ) {
  if( ! makeFrameMergingFrameOntoFrame.previewLayer ) {
    makeFrameMergingFrameOntoFrame.previewLayer = addCanvasLayer( "_temp" );
  }
  //all layertypes and frametypes must be "paint"
  const preview = makeFrameMergingFrameOntoFrame.previewLayer;
  loadLayerFrame( topLayer, topFrame, false );
  loadLayerFrame( lowerLayer, lowerFrame, false );
  sampleLayerInLayer( topLayer, lowerLayer, preview );
  lowerLayer.context.save();
  if( respectOpacity === true ) lowerLayer.context.globalAlpha = topLayer.opacity;
  lowerLayer.context.drawImage( preview.canvas, 0, 0 );
  lowerLayer.context.restore();
  const mergedFrame = makeLayerFrame( lowerLayer );
  updateLayerFrame( lowerLayer, mergedFrame );
  //if you just merged a non-current frame, you need to reload the current!
  return mergedFrame;
}

//the pixels object
const Pixels = {
  gnv: null,
  gl: null,
  cnv: null,
  ctx: null,
  ready: false,

  readFramebuffer: null,
  writeFramebuffer: null,

  idCount: 0,
  sources: {},
  views: [],
  recycledCanvases: [],

};
{
  const MAX_16 = 2**16 - 1,
    MAX_32 = 2**32 - 1;
  const STRING_FORMAT = "image/webp";
  const setup = ( webgl2Canvas, webgl2Context ) => {
    Pixels.gnv = webgl2Canvas;
    Pixels.gl = webgl2Context;
    Pixels.cnv = document.createElement( "canvas" );
    Pixels.ctx = Pixels.cnv.getContext( "2d" );
    Pixels.readFramebuffer = Pixels.gl.createFramebuffer();
    Pixels.writeFramebuffer = Pixels.gl.createFramebuffer();
    Pixels.ready = true;
  }
  const reservePixels = ( formatInfo, w, h ) => {
    const { channelCount, bytesPerChannel } = formatInfo;
    const id = Pixels.idCount + 1;
    Pixels.sources[ id ] = {
      id,
      formatKey, channelCount, bytesPerChannel, w, h,
      accessed: Date.now(),
      data: null
    };
    return id;
  };
  const initializePixels = id => {
    const source = Pixels.sources[ id ];
    const { channelCount, bytesPerChannel, w, h } = source;
    const dataLength = channelCount * w * h;
    let data;
    if( bytesPerChannel === 1 ) data = new Uint8Array( dataLength );
    if( bytesPerChannel === 2 ) data = new Uint16Array( dataLength );
    if( bytesPerChannel === 4 ) data = new Uint32Array( dataLength );
    //if( bytesPerChannel === 8 ) data = new BigUint64Array( dataLength );
    //No obvious way to process 64-bit channel images???
    source.data = data;
    source.accessed = Date.now();
  };

  const getPixelsSource = id => {
    //check if the source has been stored, and reload from storage
    //this should also populate a save view; we're caching all our immediate ops to avoid duplication
    const source = Pixels.sources[ id ];
    return source;
  }

  const disposable32FromSource = () => {
    //use this to get our paint texture from layer texture? Hmm.
  }

  const getPixelsSave = id => {
    //Compression test results:
    //For non-random data, webp is smaller than binary (1.7% of size for linear data) and smaller than png
    //For a 1-channel random image (2 zero-filled channels, opaque alpha), webp is 1/3 the size of binary.
    //For a 1-channel linear image (2 zero-filled channels, opaque alpha), webp is 1/3 the size of binary.
    //Binary data always retrieved with perfect accuracy if and only if opaque alpha

    let view = null;
    
    if( ! view ) {
      const source = getPixelsSource( id );
      const { channelCount, bytesPerChannel, w, h, data } = source;
      
      const saveObject = { id, channelCount, bytesPerChannel, w, h, channels: new Array( channelCount ) };
  
      let imagesPerChannel = parseInt( bytesPerChannel / 3 );
      if( bytesPerChannel % 3 !== 0 ) imagesPerChannel += 1;
  
      const { channels } = saveObject;
      const { cnv, ctx } = Pixels;
      cnv.width = w;
      cnv.height = h;
  
      //Our data is a list of 32-bit ints representing RGBA
      //We want to walk by strides of 4: 0,3,7... Gives us our R32 values
      //For each R32 value, we have 4 bytes
      //3 of those bytes go in the RGB of image[0]
      //1 of those bytes goes in the R of image[1]
  
      for( let channelId = 0; channelId < channelCount; channelId++ ) {
        channels[ channelId ] = new Array( imagesPerChannel );
        for( let channelImageIndex = 0; channelImageIndex < imagesPerChannel; channelImageIndex++ ) {
          const imageData = ctx.createImageData( w, h );
          const dest = imageData.data;
          //walk along our channel values
          for( let channelValueIndex = channelId, countIndex = 0; channelValueIndex < data.length; channelValueIndex += channelCount, countIndex++ ) {
            const imageDataIndex = countIndex * 4;
            //store first 3 bytes
            if( channelImageIndex === 0 ) {
              dest[ imageDataIndex + 0 ] = data[ channelValueIndex ] && 0xFF;
              dest[ imageDataIndex + 1 ] = ( data[ channelValueIndex ] >> 8 ) && 0xFF;
              dest[ imageDataIndex + 2 ] = ( data[ channelValueIndex ] >> 16 ) && 0xFF;
              dest[ imageDataIndex + 3 ] = 0xFF;
            }
            //store 4th byte
            if( channelImageIndex === 1 ) {
              dest[ imageDataIndex + 0 ] = ( data[ channelValueIndex ] >> 24 ) && 0xFF;
              dest[ imageDataIndex + 1 ] = 0xFF;
              dest[ imageDataIndex + 2 ] = 0xFF;
              dest[ imageDataIndex + 3 ] = 0xFF;
            }
          }
          ctx.putImageData( imageData, 0, 0 );
          channels[ channelId ][ channelImageIndex ] = cnv.toDataURL( STRING_FORMAT, 1 );
        }
      }
  
      view = { id, save: saveObject, w, h, accessed: Date.now() }
    }

    return view;

  }

  const loadPixelsSave = saveObject => {

    const { id, channelCount, bytesPerChannel, w, h, channels } = saveObject;
    Pixels.sources[ id ] = { }

  }

  const cleanUpMemory = () => {
    //compare total memory against reasonable or configured limits
    //if there is desirable action:
    //  clear out unused views
    //  store unused data
  }

  const getPixelsView = ( id, formatKey, w, h, options ) => {
    //For texture formats:
    //https://webgl2fundamentals.org/webgl/lessons/webgl-data-textures.html
    const { gl, gnv } = Pixels;
    const source = getPixelsSource( id );
    if( formatKey === "texture-u32" && ( w !== source.w ) || ( h !== source.h ) ) {
      throw console.error( "Pixel view 'texture-u32' must match pixel source dimensions! Did you mean to use 'texture-rgba8-scaled'?" );
    }

    let view = Pixels.views.find( v => v.id === id && v.formatKey === formatKey && v.w === w && v.h === h );

    if( ! view ) {
      if( formatKey === "texture-u32" ) {
        //TODO: Don't assume source format! I want r8 format for masks and selections.
        //native format
        //create a gltexture and upload the source data
        const texture = gl.createTexture();
        gl.bindTexture( gl.TEXTURE_2D, texture );
        gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA32UI, source.w, source.h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, source.data );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        view = { id, formatKey, texture, w, h, accessed: Date.now() }
        Pixels.views.push( view );
      }
      if( formatKey === "texture-rgba8-scaled" ) {
        //proven working in experiment
        //TODO: Update renderlayers to use this blit op instead of last screen-draw
        //get the texture 32 view
        const texture32View = getPixelsView( id, "texture-u32", source.w, source.h );
        //attach the texture 32 view to the read framebuffer
        {
          gl.bindTexture( gl.TEXTURE_2D, texture32View.texture );
          gl.bindFramebuffer( gl.FRAMEBUFFER, Pixels.readFramebuffer );
          gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture32View.texture, 0 );
        }

        const texture = gl.createTexture();
        gl.bindTexture( gl.TEXTURE_2D, texture );
        gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        //attach the scaled texture to the write framebuffer
        {
          gl.bindTexture( gl.TEXTURE_2D, texture );
          gl.bindFramebuffer( gl.FRAMEBUFFER, Pixels.writeFramebuffer );
          gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        }

        //bind the read and write framebuffers
        gl.bindFramebuffer( gl.READ_FRAMEBUFFER, Pixels.readFramebuffer );
        gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, Pixels.writeFramebuffer );
        //copy
        gl.blitFramebuffer( 0, 0, source.w, source.h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST );

        view = { id, formatKey, texture, w, h, accessed: Date.now() };

      }
      if( formatKey === "canvas" ) {
        //return an HTML canvas

        //get the scaled pixel view
        //bind the texture to the readFramebuffer
        //get a recycled canvas, or create a new one
        //gl.readpixels into an image data
        //put the image data onto the canvas
        //return the canvas
      }
      if( formatKey === "string" ) {
        //return a data url string (this is NOT a lossless compression of the pixel data)
        
        //get the canvas view
        //call toDataURL with png, webp, or jpg depending on options{}
        //return the string view
      }
      if( formatKey === "image" ) {
        //return an HTML image

        //get the string, options{}: lossless png/webp (for export) |or| lossy jpg (e.g. UI frame thumbnail)
      }
      //etc
    }

    view.accessed = Date.now();

    return view;
  };



}

let layersAddedCount = 0,
  tempLayersAddedCount = 0;
function addCanvasLayer( layerType, layerWidth=null, layerHeight=null, nextSibling=null, doNotUpdate=false ) {
  
  //layerType === "paint" | "_temp" | "generative" | "group" | "text" | "pose" | "filter" | "model" | ...

  let layerCenterX = W/2,
    layerCenterY = H/2;
  let topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner;

  if( layerWidth === null || layerHeight === null ) {
    if( [ "paint", "generative", "text" ].includes( selectedLayer?.layerType ) ) {
      layerWidth = selectedLayer.w;
      layerHeight = selectedLayer.h;
      const { topLeft, topRight, bottomLeft, bottomRight } = selectedLayer;
      topLeftCorner = [...topLeft];
      topRightCorner = [...topRight];
      bottomLeftCorner = [...bottomLeft];
      bottomRightCorner = [...bottomRight];
    } else {
      //get dimensions only from the top layer
      for( let i = layersStack.layers.length-1; i >= 0; i-- ) {
        const stackLayer = layersStack.layers[ i ];
        if( ! [ "paint", "generative", "text" ].includes( stackLayer.layerType ) )
          continue;
        layerWidth = stackLayer.w;
        layerHeight = stackLayer.h;
        break;
      }
      //finally, get default from settings
      if( layerWidth === null || layerWidth === null ) {
        layerWidth = uiSettings.defaultLayerWidth;
        layerHeight = uiSettings.defaultLayerHeight;
      }
    }
  }

  topLeftCorner =  [layerCenterX-layerWidth/2,layerCenterY-layerHeight/2,1];
  topRightCorner = [layerCenterX+layerWidth/2,layerCenterY-layerHeight/2,1];
  bottomLeftCorner = [layerCenterX-layerWidth/2,layerCenterY+layerHeight/2,1];
  bottomRightCorner = [layerCenterX+layerWidth/2,layerCenterY+layerHeight/2,1];

  let apiFlowName = null;
  for( let i = layersStack.layers.length-1; i >= 0; i-- ) {
    const stackLayer = layersStack.layers[ i ];
    if( stackLayer.layerType !== "generative" )
      continue;
    apiFlowName = stackLayer.generativeSettings.apiFlowName;
    break;
  }
  if( apiFlowName === null ) apiFlowName = uiSettings.defaultAPIFlowName;

  let filterName = null;
  for( let i = layersStack.layers.length-1; i >= 0; i-- ) {
    const stackLayer = layersStack.layers[ i ];
    if( stackLayer.layerType !== "filter" )
      continue;
    filterName = stackLayer.filtersSettings.filterName;
    break;
  }
  if( filterName === null ) filterName = uiSettings.defaultFilterName;

  //create the back-end layer info
  let layerId;
  if( layerType === "_temp" ) layerId = -1 * (++tempLayersAddedCount);
  else layerId = ++layersAddedCount;

  const newLayer = {
    //layerOrder: layersStack.layers.length, //not implemented
    layerType,
    layerName: "Layer " + layerId,
    layerId: layerId,
    layerGroupId: null,
    groupCompositeUpToDate: false,
    groupClosed: false,

    visible: true,
    setVisibility: null,
    opacity:1.0,
    setOpacity: null,
    alphaLocked: false,
    setAlphaLocked: null,
    blendMode: glState.layerBlendModes[ 0 ],
    setBlendMode: null,

    generativeSettings: { apiFlowName },
    generativeControls: {},
    filtersSettings: { filterName },
    filterControls: {},

    currentFrameIndex: uiSettings.currentTimeSeekIndex,
    frames: [], //should really auto-populate this on create layer

    nodeUplinks: new Set(),

    rig: null,
    textInfo: JSON.parse( JSON.stringify( uiSettings.defaultTextInfo ) ),
    vectors: [],

    //we can use transform + l/w to rectify our points and avoid drift accumulation
    transform: {
      scale: 1,
      angle: 0,
      transformingPoints: {
        topLeft:[...topLeftCorner],
        topRight:[...topRightCorner],
        bottomLeft:[...bottomLeftCorner],
        bottomRight:[...bottomRightCorner],    
      }
    },
    w:layerWidth, h:layerHeight,

    topLeft:topLeftCorner,
    topRight:topRightCorner,
    bottomLeft:bottomLeftCorner,
    bottomRight:bottomRightCorner,

    canvas: document.createElement("canvas"),
    context: null,

    maskCanvas: document.createElement( "canvas" ),
    maskContext: null,
    maskInitialized: false,
    maskInitializedState: null,
    maskUnpainted: true,

    dataCache: [],

    glTexture: null,
    textureChanged: false,
    textureChangedRect: {x:0,y:0,w:layerWidth,h:layerHeight},

    glMask: null,
    maskChanged: false,
    maskChangedRect: {x:0,y:0,w:layerWidth,h:layerHeight},

    layerButton: null,

  }

  if( newLayer.layerType === "paint" ) newLayer.layerName = "Paint " + newLayer.layerName;
  if( newLayer.layerType === "generative" ) newLayer.layerName = "Gen " + newLayer.layerName;
  if( newLayer.layerType === "group" ) newLayer.layerName = newLayer.layerName.replace( "Layer", "Group" );
  if( newLayer.layerType === "vector" ) newLayer.layerName = "Vector " + newLayer.layerName;
  if( newLayer.layerType === "text" ) newLayer.layerName = "Text " + newLayer.layerName;
  if( newLayer.layerType === "pose" ) newLayer.layerName = "Pose " + newLayer.layerName;

  newLayer.canvas.width = layerWidth;
  newLayer.canvas.height = layerHeight;
  newLayer.context = newLayer.canvas.getContext( "2d" );

  newLayer.maskCanvas.width = layerWidth;
  newLayer.maskCanvas.height = layerHeight;
  newLayer.maskContext = newLayer.maskCanvas.getContext( "2d" );
  //opacify the mask
  newLayer.maskContext.fillStyle = "rgb(255,255,255)";
  newLayer.maskContext.fillRect( 0,0,layerWidth,layerHeight );

  //add layer to stack
  if( newLayer.layerType !== "_temp" ) {
    if( selectedLayer && ! nextSibling )
        nextSibling = selectedLayer;
  
    if( nextSibling ) {
      if( nextSibling === selectedLayer && selectedLayer.layerType === "group" ) {
        const index = layersStack.layers.indexOf( nextSibling );
        newLayer.layerGroupId = selectedLayer.layerId;
        layersStack.layers.splice( index, 0, newLayer );
      }
      else if( nextSibling === selectedLayer && selectedLayer.layerGroupId !== null ) {
        const index = layersStack.layers.indexOf( nextSibling );
        newLayer.layerGroupId = selectedLayer.layerGroupId;
        layersStack.layers.splice( index+1, 0, newLayer );
      }
      else {
        const index = layersStack.layers.indexOf( nextSibling );
        layersStack.layers.splice( index+1, 0, newLayer );
      }
    } else {
      layersStack.layers.push( newLayer );
    }
  }

  {
    //create the layer's texture
    newLayer.glTexture = gl.createTexture();
    gl.activeTexture( gl.TEXTURE0 + 0 );
    gl.bindTexture( gl.TEXTURE_2D, newLayer.glTexture ); 
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );
    {
      const mipLevel = 0,
        internalFormat = gl.RGBA,
        //internalFormat = gl.RGBA16F,
        srcFormat = gl.RGBA,
        srcType = gl.UNSIGNED_BYTE;
      gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, newLayer.canvas );
    }
  }

  {
    //create the layer's mask
    newLayer.glMask = gl.createTexture();
    gl.activeTexture( gl.TEXTURE0 + 1 );
    gl.bindTexture( gl.TEXTURE_2D, newLayer.glMask ); 
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );
    {
      const mipLevel = 0,
        internalFormat = gl.RGBA,
        //internalFormat = gl.RGBA16F,
        srcFormat = gl.RGBA,
        srcType = gl.UNSIGNED_BYTE;
      gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, newLayer.maskCanvas );
    }
  }

  //render the pose layer
  if( newLayer.layerType === "pose" ) {
    newLayer.rig = JSON.parse( JSON.stringify( uiSettings.defaultPoseRig ) );
    //scale the rig to this layer
    let centerX = layerWidth/2, centerY = layerHeight/2,
      scale = Math.min( layerWidth, layerHeight );
    for( const node of Object.values( newLayer.rig ) ) {
      node.x = ( ( node.x - 0.5 ) * scale ) + centerX;
      node.y = ( ( node.y - 0.5 ) * scale ) + centerY;
    }
    //render our first pass
    renderLayerPose( newLayer );
  }

  let layerButton;
  if( layerType !== "_temp" ) {
    //create the layer button
    layerButton = document.createElement( "div" );
    layerButton.classList.add( "layer-button", "expanded" );
    if( newLayer.layerType !== "group" ) {
      layerButton.appendChild( newLayer.canvas );
    }
    layerButton.layer = newLayer; //Yep, I'm adding it. Double-link.
    newLayer.layerButton = layerButton;
    let startScrollingOffset = 0,
      currentlyScrolling = false,
      layersColumn;
    UI.registerElement(
      layerButton,
      { 
        //onclick: () => selectLayer( newLayer ) 
        ondrag: ({start,current,ending}) => {
          const dy = current.y - start.y,
            dt = current.t - start.t;
          if( !currentlyScrolling && ending === true && dt < uiSettings.clickTimeMS && Math.abs(dy) < 5 ) {
            if( newLayer !== selectedLayer ) {
              selectLayer( newLayer );
            }
            else if( newLayer === selectedLayer && newLayer.layerType === "group" ) {
              newLayer.groupClosed = ! newLayer.groupClosed;
              reorganizeLayerButtons();
            }
          }
          if( !currentlyScrolling && ( Math.abs( dy ) > 5 || dt > uiSettings.clickTimeMS ) ) {
            currentlyScrolling = true;
            layersColumn = document.querySelector( "#layers-column" );
            layersColumn.classList.remove( "animated" );
            startScrollingOffset = layersColumn.scrollOffset;
          }
          if( ending === false && currentlyScrolling ) {
            const scrollAdjust = startScrollingOffset + dy;
            layersColumn.scrollToPosition( scrollAdjust, true ); //with overbounce
          }
          if( ending === true && currentlyScrolling ) {
            currentlyScrolling = false;
            layersColumn.classList.add( "animated" );
            layersColumn.scrollToPosition( startScrollingOffset + dy ); //no overbounce
            UI.updateContext(); //doesn't necessarily call scrolltoposition
          }
        }
      },
      { tooltip: ["Select Layer", "to-left", "above-center" ], zIndex:100 }
    );

    //add the header and footer rows
    let headerRow, footerRow;
    {
      headerRow = document.createElement( "div" );
      headerRow.classList.add( "layer-button-header-row" );
      layerButton.appendChild( headerRow );
    }
    {
      footerRow = document.createElement( "div" );
      footerRow.classList.add( "layer-button-footer-row" );
      layerButton.appendChild( footerRow );
    }

    //add the layer type icon
    {
      const groupIcon = document.createElement( "div" );
      groupIcon.classList.add( "layer-type-icon", newLayer.layerType );
      if( newLayer.layerType === "group" ) {
        groupIcon.classList.add( "open" );
        UI.registerElement(
          groupIcon,
          {
            onclick: () => {
              if( newLayer.layerType !== "group" ) return;
              newLayer.groupClosed = ! newLayer.groupClosed;
              if( newLayer.groupClosed ) {
                groupIcon.querySelector( ".tooltip" ).textContent = "Open Group";
                groupIcon.classList.remove( "open" );
              }
              else {
                groupIcon.querySelector( ".tooltip" ).textContent = "Close Group";
                groupIcon.classList.add( "open" );
              }
              reorganizeLayerButtons();
            }
          },
          { tooltip: ["Close Group", "to-left", "above-center" ], zIndex:100 }
        )
      }
      layerButton.appendChild( groupIcon );
    }

    //add the select box icon
    {
      const selectIcon = document.createElement( "div" );
      selectIcon.classList.add( "layer-select-icon", newLayer.layerType );
      UI.registerElement(
        selectIcon,
        {
          onclick: () => {
            if( batchedLayers.has( newLayer ) ) {
              removeLayerFromSelection( newLayer );
            }
            else if( selectedLayer === newLayer ) {
                selectLayer( null );
            }
            else {
              addLayerToSelection( newLayer );
            }
            reorganizeLayerButtons();
            UI.updateContext();
          },
          updateContext: () => {
            if( batchedLayers.has( newLayer ) ) {
              selectIcon.querySelector( ".tooltip" ).textContent = "Remove Layer from Selected";
            }
            else if( selectedLayer === newLayer ) {
                selectIcon.querySelector( ".tooltip" ).textContent = "Unselect Layer";
            }
            else {
              selectIcon.querySelector( ".tooltip" ).textContent = "Add Layer to Selected";
            }
          }
        },
        { tooltip: ["Add Layer to Selected", "to-left", "above-center" ], zIndex:100 }
      )
      layerButton.appendChild( selectIcon );
    }

    //add the layer group joiner
    {
      const layerGroupJoiner = document.createElement( "div" );
      layerGroupJoiner.classList.add( "layer-group-joiner" );
      layerButton.appendChild( layerGroupJoiner );
    }

    //add the reorganizer drop-zones
    {
      const upperDropzone = document.createElement( "div" );
      upperDropzone.classList.add( "layer-upper-dropzone", "animated" );
      layerButton.appendChild( upperDropzone );
      const lowerDropZone = document.createElement( "div" );
      lowerDropZone.classList.add( "layer-lower-dropzone", "animated" );
      layerButton.appendChild( lowerDropZone );
      const lowerDropzoneGroupJoiner = document.createElement( "div" );
      lowerDropzoneGroupJoiner.classList.add( "layer-lower-dropzone-group-joiner", "animated" );
      layerButton.appendChild( lowerDropzoneGroupJoiner );
    }

    //the visibility button
    {
      newLayer.setVisibility = visible => {
        newLayer.visible = visible;
        if( newLayer.visible ) visibilityButton.classList.remove( "off" );
        else visibilityButton.classList.add( "off" );
      }
      const visibilityButton = document.createElement( "div" );
      visibilityButton.classList.add( "layer-visibility-button", "layer-ui-button", "animated" );
      UI.registerElement(
        visibilityButton,
        { onclick: () => newLayer.setVisibility( !newLayer.visible ) },
        { tooltip: [ "Layer Visibility On/Off", "above", "to-left-of-center" ], zIndex:1000 }
      )
      headerRow.appendChild( visibilityButton );
    }
    
    //the alpha lock button
    {
      newLayer.setAlphaLocked = alphaLocked => {
        newLayer.alphaLocked = alphaLocked;
        if( newLayer.alphaLocked ) alphaLockButton.classList.add( "locked" );
        else alphaLockButton.classList.remove( "locked" );
      }
      const alphaLockButton = document.createElement( "div" );
      alphaLockButton.classList.add( "layer-alpha-lock-button", "unlocked", "layer-ui-button", "animated" );
      UI.registerElement(
        alphaLockButton,
        {
          onclick: () => newLayer.setAlphaLocked( !newLayer.alphaLocked ),
          updateContext: () => {
            if( newLayer.layerType === "paint" ) {
              if( layerButton.classList.contains( "active" ) )
                alphaLockButton.classList.remove( "hidden" );
              else alphaLockButton.classList.add( "hidden" );
            }
            else alphaLockButton.classList.add( "hidden" );
          }
        },
        { tooltip: [ "Layer Alpha Lock/Unlock", "above", "to-left-of-center" ], zIndex:1000 }
      )
      headerRow.appendChild( alphaLockButton );
    }

    //the duplicate button
    {
      const duplicateButton = document.createElement( "div" );
      duplicateButton.classList.add( "layer-duplicate-button", "layer-ui-button", "animated" );
      UI.registerElement(
        duplicateButton,
        {
          onclick: async () => {

            //duplicate layer(s)
            //when the duplicate button is clicked from here, it ignores multiple-selected layers
            
            const groupedLayers = [ newLayer ];
            if( newLayer.layerType === "group" ) {
              for( let i = layersStack.layers.indexOf( newLayer )-1; i>=0; i-- ) {
                const layer = layersStack.layers[ i ];
                if( ! getLayerGroupChain( layer ).includes( newLayer.layerId ) ) break;
                groupedLayers.push( layer );
              }
            }

            duplicateLayersAndRecordUndo( groupedLayers, true, false );

          },
          updateContext: () => {
            if( layerButton.classList.contains( "active" ) )
              duplicateButton.classList.remove( "hidden" );
            else duplicateButton.classList.add( "hidden" );
          }
        },
        { tooltip: [ "Duplicate Layer", "above", "to-left-of-center" ], zIndex:1000 }
      )
      headerRow.appendChild( duplicateButton );
    }

    //the layer name
    {
      const layerName = document.createElement( "div" );
      layerName.classList.add( "layer-name", "animated"  );
      const layerNameText = layerName.appendChild( document.createElement( "span" ) );
      layerNameText.classList.add( "layer-name-text" );
      layerNameText.textContent = newLayer.layerName;
      UI.registerElement(
        layerName,
        {
          onclick: () => {
            UI.showOverlay.text({
              value: newLayer.layerName,
              onapply: text => {
                //get old and new values
                const oldLayerName = newLayer.layerName;
                const newLayerName = text;
                
                newLayer.layerName = text;
                layerNameText.textContent = newLayer.layerName;
                layerName.querySelector( ".tooltip" ).textContent = `Rename Layer [${newLayer.layerName}]`;
  
                const historyEntry = {
                  oldLayerName,
                  newLayerName,
                  targetLayer: newLayer,
                  undo: () => {
                    newLayer.layerName = oldLayerName;
                    layerNameText.textContent = newLayer.layerName;
                    layerName.querySelector( ".tooltip" ).textContent = `Rename Layer [${newLayer.layerName}]`;
                  },
                  redo: () => {
                    newLayer.layerName = newLayerName;
                    layerNameText.textContent = newLayer.layerName;
                    layerName.querySelector( ".tooltip" ).textContent = `Rename Layer [${newLayer.layerName}]`;
                  }
                }
                recordHistoryEntry( historyEntry );
              }
            });
          },
          updateContext: () => {
            layerNameText.textContent = newLayer.layerName;
          }
        },
        { tooltip: [ `Rename Layer [${newLayer.layerName}]`, "above", "to-left-of-center" ], zIndex:1000 },
      )
      headerRow.appendChild( layerName );
    }

    //the delete button
    {
      const deleteButton = document.createElement( "div" );
      deleteButton.classList.add( "layer-delete-button", "layer-ui-button", "animated"  );
      UI.registerElement(
        deleteButton,
        {
          onclick: () => deleteLayer( newLayer ),
          updateContext: () => {
            if( layerButton.classList.contains( "active" ) )
              deleteButton.classList.remove( "hidden" );
            else deleteButton.classList.add( "hidden" );
          }
        },
        { tooltip: [ "Delete Layer", "above", "to-left-of-center" ], zIndex:1000 },
      )
      headerRow.appendChild( deleteButton );
    }

    //the move handle
    {
      const moveHandle = document.createElement( "div" );
      moveHandle.classList.add( "layer-move-button", "layer-ui-button", "animated"  );
      let hoveringDropTarget = null,
        groupedLayers = [];
      UI.registerElement(
        moveHandle,
        {
          ondrag: ({ rect, start, current, ending, starting, element }) => {
            if( starting ) {
              //remove any visible links
              document.querySelectorAll( ".layer-node-tail" ).forEach( n => n.parentElement.removeChild( n ) );
              //they'll all be remade on update context (hopefully...)
              //now... remove all the layer buttons in this group if this is a group :-|
              if( newLayer.layerType === "group" ) {
                groupedLayers.length = 0;

                for( let i = layersStack.layers.indexOf( newLayer )-1; i>=0; i-- ) {
                  const layer = layersStack.layers[ i ];
                  if( ! getLayerGroupChain( layer ).includes( newLayer.layerId ) ) break;
                  groupedLayers.push( layer );
                }

                for( const layer of groupedLayers ) {
                  layer.layerButton.parentElement.removeChild( layer.layerButton );
                }

              }
              uiContainer.appendChild( layerButton );
              layerButton.style.position = "absolute";
              layerButton.classList.add( "dragging-layer-button" );
              layerButton.classList.remove( "layer-in-group" );
            }
            layerButton.style.left = `calc( ${current.x}px - 1.5rem )`;
            layerButton.style.top = `calc( ${current.y}px - 3.5rem )`;
            //check where we're hovering
            let closestLayerButton = null,
              closestLayerButtonDistance = Infinity,
              closestLayerButtonDy = 0,
              layerButtonHeight = -1;
            for( const dropzoneButton of document.querySelectorAll( "#layers-column .layer-button" ) ) {
              const r = dropzoneButton.getClientRects()[ 0 ];
              if( ! r ) continue;
              layerButtonHeight = r.height;
              const distance = Math.abs( current.y - ( r.top + r.height/2 ) );
              if( distance < closestLayerButtonDistance ) {
                //closestLayerButton?.classList.remove( "hover-drop-above", "hover-drop-below" );
                closestLayerButtonDistance = distance;
                closestLayerButtonDy = current.y - ( r.top + r.height/2 );
                closestLayerButton = dropzoneButton;
              }
            }
            if( closestLayerButton && closestLayerButtonDistance < layerButtonHeight * 2 ) {
              if( hoveringDropTarget ) hoveringDropTarget.classList.remove( "hover-drop-above", "hover-drop-below" );
              hoveringDropTarget = closestLayerButton;
              if( closestLayerButtonDy > 0 ) closestLayerButton.classList.add( "hover-drop-below" );
              else closestLayerButton.classList.add( "hover-drop-above" );
            }
            else if( hoveringDropTarget ) {
              hoveringDropTarget.classList.remove( "hover-drop-above", "hover-drop-below" );
              hoveringDropTarget = null;
            }
            //TODO: Implement scroll on layer reorganize
            if( ending ) {
              let newIndex;
              if( hoveringDropTarget ) {
                //get old and new indices for the layer drop
                const oldIndex = layersStack.layers.indexOf( newLayer );

                layersStack.layers.splice( oldIndex, 1 + groupedLayers.length );

                newIndex = layersStack.layers.indexOf( hoveringDropTarget.layer );

                const oldGroupId = newLayer.layerGroupId;

                if( hoveringDropTarget.classList.contains( "hover-drop-above" ) ) newIndex += 1;

                if( hoveringDropTarget.layer.layerType === "group" ) {
                  if( hoveringDropTarget.classList.contains( "hover-drop-above" ) ) {
                    newLayer.layerGroupId = hoveringDropTarget.layer.layerGroupId;
                  } else {
                    newLayer.layerGroupId = hoveringDropTarget.layer.layerId;
                  }
                }
                else {
                  //require match even on null (which is effectively top-row group)
                  newLayer.layerGroupId = hoveringDropTarget.layer.layerGroupId;
                }

                const newGroupId = newLayer.layerGroupId;

                //recording undo event even on drop-in-same-place, should probably fix eventually
                layersStack.layers.splice( newIndex, 0, newLayer, ...groupedLayers );

                //clean up the hovering visuals
                hoveringDropTarget.classList.remove( "hover-drop-above", "hover-drop-below" );

                {
                  const historyEntry = {
                    oldIndex,
                    oldGroupId,
                    newIndex,
                    newGroupId,
                    targetLayer: newLayer,
                    groupedLayers: [ ...groupedLayers ],
                    undo: () => {
                      newLayer.layerGroupId = historyEntry.oldGroupId;
                      layersStack.layers.splice( historyEntry.newIndex, 1+historyEntry.groupedLayers.length );
                      layersStack.layers.splice( historyEntry.oldIndex, 0, historyEntry.targetLayer, ...historyEntry.groupedLayers );
                      reorganizeLayerButtons();
                    },
                    redo: () => {
                      newLayer.layerGroupId = historyEntry.newGroupId;
                      layersStack.layers.splice( historyEntry.oldIndex, 1+historyEntry.groupedLayers.length );
                      layersStack.layers.splice( historyEntry.newIndex, 0, historyEntry.targetLayer, ...historyEntry.groupedLayers );
                      reorganizeLayerButtons();
                    }
                  }
                  recordHistoryEntry( historyEntry );
                }
              }
              layerButton.style = "";
              layerButton.classList.remove( "dragging-layer-button" );
              reorganizeLayerButtons();
            }
          },
        },
        { tooltip: [ "Reorganize Layer", "to-left", "vertical-center" ], zIndex:1000 },
      )
      footerRow.appendChild( moveHandle );
    }

    //the layer blend mode
    {
      const layerBlendModeButton = document.createElement( "div" );
      layerBlendModeButton.classList.add( "layer-blend-mode", "animated"  );
      const layerBlendModeText = layerBlendModeButton.appendChild( document.createElement( "span" ) );
      layerBlendModeText.classList.add( "layer-blend-mode-text" );
      layerBlendModeText.textContent = newLayer.blendMode;
      let showingBlendModePanel = false;
      UI.registerElement(
        layerBlendModeButton,
        {
          onclick: () => {
            showingBlendModePanel = ! showingBlendModePanel;
            UI.updateContext();
          },
          updateContext: () => {
            layerBlendModeText.textContent = newLayer.blendMode;
            layerBlendModeButton.querySelector( ".tooltip" ).textContent = `Set Layer Blend Mode [${newLayer.blendMode}]`;
            if( layerButton.classList.contains( "active" ) ) layerBlendModeButton.classList.remove( "hidden" );
            else layerBlendModeButton.classList.add( "hidden" );
          }
        },
        { tooltip: [ `Set Layer Blend Mode [${newLayer.blendMode}]`, "above", "to-left-of-center" ], zIndex:1000 },
      )
      footerRow.appendChild( layerBlendModeButton );

      //the blend mode hovering panel
      {
        const blendModePanel = document.createElement( "div" );
        blendModePanel.classList.add( "blend-mode-panel", "center", "animated" );
        layerBlendModeButton.appendChild( blendModePanel );

        //add the stylized summon marker arrow to the top-right
        const summonMarker = document.createElement( "div" );
        summonMarker.classList.add( "summon-marker" );
        blendModePanel.appendChild( summonMarker );

        UI.registerElement( blendModePanel, {
          onclickout: () => {
            showingBlendModePanel = false;
            UI.updateContext();
          },
          updateContext: () => {
            if( showingBlendModePanel === true ) {
              blendModePanel.classList.remove( "hidden" );
              //can't set height from here? Hmm. I mean, I could if I could edit CSS rules... Let's call it todo
              const y = layerBlendModeButton.getClientRects()[ 0 ].y / window.innerHeight;
              if( y < 0.4 ) {
                layerBlendModeButton.querySelector( ".blend-mode-panel" ).classList.remove( "above", "center" );
                layerBlendModeButton.querySelector( ".blend-mode-panel" ).classList.add( "below" );
              }
              else if( y > 0.6 ) {
                layerBlendModeButton.querySelector( ".blend-mode-panel" ).classList.remove( "below", "center" );
                layerBlendModeButton.querySelector( ".blend-mode-panel" ).classList.add( "above" );
              }
              else {
                layerBlendModeButton.querySelector( ".blend-mode-panel" ).classList.remove( "below", "above" );
                layerBlendModeButton.querySelector( ".blend-mode-panel" ).classList.add( "center" );
              }
            }
            else blendModePanel.classList.add( "hidden" );
          },
        }, { zIndex: 10000 } );

        for( const blendModeName of glState.layerBlendModes ) {

          //the blend mode button
          {
            const blendModeButton = blendModePanel.appendChild( document.createElement( "div" ) );
            blendModeButton.classList.add( "rounded-line-button", "animated" );
            blendModeButton.appendChild( document.createElement("span") ).textContent = blendModeName;
            UI.registerElement( blendModeButton, {
              onclick: () => {
                blendModeButton.classList.add( "pushed" );
                setTimeout( () => blendModeButton.classList.remove( "pushed" ), UI.animationMS );
                newLayer.blendMode = blendModeName;
                showingBlendModePanel = false;
                UI.updateContext();
              }
            }, { 
              tooltip: [ `Set Layer Blend Mode to "${blendModeName}"`, "to-left", "vertical-center" ],
              zIndex: 11000
            } );
          }

          //add a spacer if more blend modes to follow
          if( blendModeName !== glState.layerBlendModes.at(-1) )
            blendModePanel.appendChild( document.createElement( "div" ) ).className = "spacer";    

        }

      }

    }

    //add the opacity slider
    {
      newLayer.setOpacity = ( opacity, skipHTML=false ) => {
        newLayer.opacity = opacity;
        if( skipHTML === false ) opacitySlider.setValue( opacity );
      }
      const opacitySlider = UI.make.slider( {
        orientation: "horizontal",
        onchange: value => newLayer.setOpacity( value, true ),
        initialValue: 1,
        min: 0,
        max: 1,
        tooltip: [ "Set Layer Opacity", "to-left", "vertical-center" ],
        zIndex:1000,
        updateContext: () => {
          if( typeof opacitySlider !== "object" ) return;
          if( layerButton.classList.contains( "active" ) )
            opacitySlider.classList.remove( "hidden" );
          else opacitySlider.classList.add( "hidden" );
        }
      })
      opacitySlider.classList.add( "layer-opacity-slider", "animated" );
      footerRow.appendChild( opacitySlider );
    }

    //add the merge-down button
    {
      const mergeButton = document.createElement( "div" );
      mergeButton.classList.add( "layer-merge-button", "layer-ui-button", "animated" );
      UI.registerElement(
        mergeButton,
        {
          onclick: () => {
            //The button should only be enabled if merging is possible, but let's check anyway.
            const index = layersStack.layers.indexOf( newLayer );
            if( layersStack.layers[ index - 1 ]?.layerType === "paint" &&
                layersStack.layers[ index - 1 ]?.layerGroupId === newLayer.layerGroupId ) {
              const lowerLayer = layersStack.layers[ index - 1 ];

              //update frames if necessary
              flushLayerUpdates();

              //save the current, un-merged lower layer
              const oldData = lowerLayer.context.getImageData( 0,0,lowerLayer.w,lowerLayer.h );

              //this layer can't be a group layer, because those can't be merged.
              //(They can be flattened to paint layers though.)

              //sample this layer onto the lower layer
              renderLayersIntoPointRect( lowerLayer, [ lowerLayer, newLayer ], [], 0, lowerLayer, [0,0,0,0], false, false );

              //merge the sampled area onto the lower layer
              if( false ) {
                lowerLayer.context.save();
                lowerLayer.context.globalAlpha = newLayer.opacity;
                lowerLayer.context.drawImage( previewLayer.canvas, 0, 0 );
                lowerLayer.context.restore();
              }
              //flag the lower layer for GPU upload
              flagLayerTextureChanged( lowerLayer, null, false );
              //delete this upper layer from the stack
              layersStack.layers.splice( index, 1 );
              //select the lower layer
              selectLayer( lowerLayer );

              //get a new set of frames for the lower layer
              console.warn( "Layer merge needs to compose merged timline for layers with more than 1 frame!" );
              const oldFrames = lowerLayer.frames;
              const newFrames = [];
              //use math.min on frame.timeIndex to advance zero or one frames at a time through both layers' timelines
              for( let i=0; i<1; i++ ) {
                const mergedFrame = makeFrameMergingFrameOntoFrame( newLayer, newLayer.frames[i], lowerLayer, lowerLayer.frames[i] );
                newFrames.push( mergedFrame );
              }
              lowerLayer.frames = newFrames;
              lowerLayer.currentFrameIndex = 0;
              loadLayerFrame( lowerLayer, lowerLayer.frames[ 0 ], false );
              flagLayerTextureChanged( lowerLayer, null, false );

              const historyEntry = {
                index,
                upperLayer: newLayer,
                lowerLayer,
                oldData,
                newData: null,
                oldFrames,
                newFrames,
                undo: () => {
                  if( historyEntry.newData === null ) {
                    historyEntry.newData = lowerLayer.context.getImageData( 0,0,lowerLayer.w,lowerLayer.h );
                  }
                  //restore the lower layer's data
                  historyEntry.lowerLayer.context.putImageData( historyEntry.oldData, 0, 0 );
                  //and flag it for GPU upload
                  flagLayerTextureChanged( historyEntry.lowerLayer );
                  //reinsert the upper layer into the layer's stack
                  layersStack.layers.splice( historyEntry.index, 0, historyEntry.upperLayer );
                  //reattach the old frames
                  historyEntry.lowerLayer.frames = historyEntry.oldFrames;
                  reorganizeLayerButtons();
                  UI.updateContext();

                },
                redo: () => {
                  //delete the upper layer from the stack
                  layersStack.layers.splice( historyEntry.index, 1 );
                  //blit the merged data agaain
                  historyEntry.lowerLayer.context.putImageData( historyEntry.newData, 0, 0 );
                  //and flag for GPU upload
                  flagLayerTextureChanged( historyEntry.lowerLayer );
                  //reattach the new frames
                  historyEntry.lowerLayer.frames = historyEntry.newFrames;
                  reorganizeLayerButtons();
                  UI.updateContext();

                }
              }
              recordHistoryEntry( historyEntry );
              
              reorganizeLayerButtons();
              UI.updateContext();


            } else {
              //Disable the merge button. We should never end up here, but who knows.
              mergeButton.classList.remove( "enabled" );
              mergeButton.uiActive = false;
            }

            UI.updateContext();

          },
          updateContext: () => {

            let isVisible = true;

            if( ! layerButton.classList.contains( "active" ) ) isVisible = false;
            
            if( isVisible === true ) {
              let canMerge = false;
              if( newLayer.layerType === "paint" ) {
                const index = layersStack.layers.indexOf( newLayer );
                if( layersStack.layers[ index - 1 ]?.layerType === "paint" &&
                    layersStack.layers[ index - 1 ]?.layerGroupId === newLayer.layerGroupId ) {
                  canMerge = true;
                }
              }
              if( canMerge === false )
                isVisible = false;
            }

            if( isVisible === false ) mergeButton.classList.add( "hidden" );
            else mergeButton.classList.remove( "hidden" );

          }
        },
        { tooltip: [ "Merge Layer Down", "above", "to-left-of-center" ], zIndex:1000 }
      )
      footerRow.appendChild( mergeButton );
    }

    //the flatten button
    {
      const flattenButton = document.createElement( "div" );
      flattenButton.classList.add( "layer-flatten-group-button", "layer-ui-button", "animated" );
      UI.registerElement(
        flattenButton,
        {
          onclick: () => {

            console.error( "Group flatten is not dealing with frames!" );

            updateLayerGroupComposite( newLayer );

            const allFlattenedLayers = collectGroupedLayersAsFlatList( newLayer.layerId );

            //get the layer indices
            const flattenedLayersAndIndices = [];
            for( let i=allFlattenedLayers.length-1; i>=0; i-- ) {
              const layer = allFlattenedLayers[i];
              const index = layersStack.layers.indexOf( layer );
              flattenedLayersAndIndices.push( [layer,index] );
            }

            //sort from highest to lowest index for extraction from list
            flattenedLayersAndIndices.sort( (a,b)=>b[1]-a[1] );
            //extract our flattened layers from the list
            for( const [,index] of flattenedLayersAndIndices )
              layersStack.layers.splice( index, 1 );

            //change our group to a paint layer
            newLayer.layerType = "paint";

            //add the layer preview
            layerButton.appendChild( newLayer.canvas );

            const historyEntry = {
              flattenedGroupLayer: newLayer,
              flattenedLayersAndIndices,
              undo: () => {
                //sort all extracted layers from lowest to highest index
                historyEntry.flattenedLayersAndIndices.sort( (a,b)=>a[1]-b[1] );
                //reinsert all flattened layers
                for( const [layer,index] of historyEntry.flattenedLayersAndIndices )
                  layersStack.layers.splice( index, 0, layer );
                //change back to a group layer
                historyEntry.flattenedGroupLayer.layerType = "group";
                reorganizeLayerButtons();
                UI.updateContext();
                //remove the layer preview
                historyEntry.flattenedGroupLayer.layerButton.removeChild( historyEntry.flattenedGroupLayer.canvas );
              },
              redo: () => {
                //sort all extracted layers from lowest to highest index
                historyEntry.flattenedLayersAndIndices.sort( (a,b)=>b[1]-a[1] );
                //reinsert all flattened layers
                for( const [,index] of historyEntry.flattenedLayersAndIndices )
                  layersStack.layers.splice( index, 1 );
                //change back to a paint layer
                historyEntry.flattenedGroupLayer.layerType = "paint";
                reorganizeLayerButtons();
                UI.updateContext();
                //add the layer preview
                historyEntry.flattenedGroupLayer.layerButton.appendChild( historyEntry.flattenedGroupLayer.canvas );
              }
            }
            recordHistoryEntry( historyEntry );

            reorganizeLayerButtons();
            UI.updateContext();
          },
          updateContext: () => {
            let isVisible = true;
            if( ! layerButton.classList.contains( "active" ) ) isVisible = false;
            if( newLayer.layerType !== "group" ) isVisible = false;
            if( isVisible === false ) flattenButton.classList.add( "hidden" );
            else flattenButton.classList.remove( "hidden" );
          }
        },
        { tooltip: [ "Flatten Group to Paint Layer", "above", "to-left-of-center" ], zIndex:1000 }
      );
      
      footerRow.appendChild( flattenButton );
    }

    //add the convert to paint layer button
    {
      const convertToPaintbutton = document.createElement( "div" );
      convertToPaintbutton.classList.add( "layer-convert-to-paint-button", "layer-ui-button", "animated" );

      UI.registerElement(
        convertToPaintbutton,
        {
          onclick: () => {
            newLayer.layerType = "paint";

            //if any layer was connected to this, pop its link
            const poppedUplinks = [];
            for( const uplinkingLayer of layersStack.layers ) {
              for( const uplink of uplinkingLayer.nodeUplinks ) {
                const { layerId, apiFlowName, controlName } = uplink;
                if( layerId === newLayer.layerId ) {
                  poppedUplinks.push( [uplinkingLayer,uplink] );
                  uplinkingLayer.nodeUplinks.delete( uplink );
                }
              }
            }
    
            const oldFrames = newLayer.frames,
              oldFrameIndex = newLayer.currentFrameIndex;
            
            const newFrames = [];
            //we need a gen -> frames button too
            const currentFrame = oldFrames[ oldFrameIndex ];
            if( currentFrame ) {
              newFrames.push( makePaintFrameFromGenerativeFrame( currentFrame ) );
              newLayer.currentFrameIndex = 0;
            }
            newLayer.frames = newFrames;

            selectLayer( newLayer );
    
            const historyEntry = {
              newLayer,
              oldFrameIndex,
              oldFrames,
              newFrames,
              poppedUplinks,
              undo: () => {
                historyEntry.newLayer.layerType = "generative";
                //reinstall popped uplinks
                for( const [uplinkingLayer,uplink] of historyEntry.poppedUplinks )
                  uplinkingLayer.nodeUplinks.add( uplink );
                //reinstall the old frames
                historyEntry.newLayer.frames = historyEntry.oldFrames;
                historyEntry.newLayer.currentFrameIndex = historyEntry.oldFrameIndex;
                UI.updateContext();
              },
              redo: () => {
                historyEntry.newLayer.layerType === "paint";
                //repop popped uplinks
                for( const [uplinkingLayer,uplink] of historyEntry.poppedUplinks )
                  uplinkingLayer.nodeUplinks.delete( uplink );
                //reinstall the new frames
                historyEntry.newLayer.frames = historyEntry.newFrames;
                historyEntry.newLayer.currentFrameIndex = 0;
                UI.updateContext();
              }
            }
            recordHistoryEntry( historyEntry );
    
            UI.updateContext();
          },
          updateContext: () => {
            let isVisible = true;
            if( ! layerButton.classList.contains( "active" ) ) isVisible = false;
            if( newLayer.layerType !== "generative" ) isVisible = false;
            if( isVisible === false ) convertToPaintbutton.classList.add( "hidden" );
            else convertToPaintbutton.classList.remove( "hidden" );
          }
        },
        { tooltip: [ "Convert to Paint Layer", "above", "to-left-of-center" ], zIndex:1000 }
      )
      
      footerRow.appendChild( convertToPaintbutton );
    }

    //add the node link source
    {
      const nodeLinkSource = document.createElement( "div" );
      nodeLinkSource.classList.add( "layer-node-link-source", "animated", "hidden" );
      //if( newLayer.layerType === "paint" || newLayer.layerType === "group" || newLayer.layerType === "text" || newLayer.layerType === "pose" )
      if( newLayer.layerType === "paint" || newLayer.layerType === "text" || newLayer.layerType === "pose" )
        nodeLinkSource.classList.remove( "hidden" );

      const createNodeTail = ( destElement, dashed = false, width = -1 ) => {
        const nodeTail = document.createElement( "div" );
        nodeTail.classList.add( "layer-node-tail" );
        nodeLinkSource.appendChild( nodeTail );
        if( dashed === true ) {
          nodeTail.classList.add( "faded" );
          nodeTail.style.width = "2rem";
          nodeTail.style.height = "4rem";
          return nodeTail;
        }
        let layerRect = document.querySelector( "#layers-column" ).getClientRects()[ 0 ],
          linkRect = nodeLinkSource.getClientRects()[ 0 ],
          destRect = destElement.getClientRects()[ 0 ];

        if( ! linkRect ) {
          console.log( "No link rect? : ", nodeLinkSource, nodeLinkSource.parentElement );
          layerButton.appendChild( nodeLinkSource );
          linkRect = nodeLinkSource.getClientRects()[ 0 ];
        }
        
        const dx = ( width === -1 ) ? linkRect.left - ( ( destRect.left + destRect.right ) / 2 ) : width;
        nodeTail.style.width = dx + "px";
        nodeTail.style.height = ( layerRect.height + window.innerHeight ) + "px";
        return nodeTail;
      }

      layerButton.appendChild( nodeLinkSource );
      let linkRect, destRects=[], draggingTail;
      UI.registerElement(
        nodeLinkSource,
        {
          ondrag: ({ rect, start, current, ending, starting, element }) => {

            if( starting ) {
              nodeLinkSource.classList.remove( "hovering" );
              linkRect = nodeLinkSource.getClientRects()[ 0 ];
              destRects.length = 0;
              const controlElements = document.querySelectorAll( ".image-input-control" );
              controlElements.forEach( controlElement => {
                const controlRect = controlElement.getClientRects()?.[ 0 ];
                if( controlRect ) destRects.push( { controlElement, controlRect } );
              } );
              draggingTail = createNodeTail( null, true );
              draggingTail.classList.remove( "faded" );
            }

            let h = 2, w = 2;
            const dx = linkRect.x - current.x,
              dy = ( linkRect.y + linkRect.height/2 ) - current.y;
              w = Math.max( w, dx );
              h = Math.max( h, dy );
              draggingTail.style.width = w + "px";
              draggingTail.style.height = h + "px";

            //do hovering effect
            for( const { controlElement, controlRect } of destRects ) {
              if( current.x >=  controlRect.left && current.y >= controlRect.top && current.x <= controlRect.right && current.y <= controlRect.bottom ) {
                controlElement.classList.add( "drop-hovering" );
              } else {
                controlElement.classList.remove( "drop-hovering" );
              }
            }

            if( ending ) {

              for( const { controlElement, controlRect } of destRects ) {
                controlElement.classList.remove( "drop-hovering" );
              }

              //remove temporary drag tail
              draggingTail.parentElement.remove( draggingTail );
              draggingTail = null;
              
              //check if we dropped in a control
              //are the generative controls visible?
              const controlsRow = document.querySelector( "#generative-controls-row" ),
                filtersRow = document.querySelector( "#filters-controls-row" ),
                controlsPanel = document.querySelector( "#generative-controls-panel" ),
                filtersPanel = document.querySelector( "#filters-controls-panel" );
              if( ! controlsRow.classList.contains( "hidden" ) || ! filtersRow.classList.contains( "hidden" ) ) {
                //get all image input controls
                const controlElements = document.querySelectorAll( ".image-input-control" );
                for( const controlElement of controlElements ) {
                  const controlRect = controlElement.getClientRects()[ 0 ];
                  if( current.x >=  controlRect.left && current.y >= controlRect.top && current.x <= controlRect.right && current.y <= controlRect.bottom ) {
                    

                    //if this control element already had an existing uplink layer, erase the link
                    if( controlElement.uplinkLayer ) {
                      for( const uplink of controlElement.uplinkLayer.nodeUplinks ) {
                        if(
                          uplink.layerId === selectedLayer.layerId &&
                          ( uplink.apiFlowName === selectedLayer.generativeSettings.apiFlowName || uplink.filterName === selectedLayer.filterSettings.filterName ) &&
                          uplink.controlName === controlElement.controlName
                        ) {
                          controlElement.uplinkLayer.nodeUplinks.delete( uplink );
                          break;
                        }
                      }
                      controlElement.uplinkLayer = null;
                    }

                    

                    //dropped into new uplink destination, record
                    newLayer.nodeUplinks.add( {
                      //layer: selectedLayer,
                      layerId: selectedLayer.layerId,
                      isFilterInput: !!controlElement.isFilterInput,
                      apiFlowName: (!!controlElement.isFilterInput) ? "" : controlsPanel.apiFlowName,
                      filterName: filtersPanel.filterName,
                      controlName: controlElement.controlName,
                      width: linkRect.left - ( ( controlRect.left + controlRect.right ) / 2 )
                      //element: controlElement
                    } );
                    controlElement.uplinkLayer = newLayer;

                    //stop searching
                    break;
                  }
                }
              }

              //remake the node links
              UI.updateContext();
  
            }
            
          },
          updateContext: () => {

            layerButton.appendChild( nodeLinkSource );

            let handleIsVisible = true;
            if( ! (newLayer.layerType === "paint" || newLayer.layerType === "group" || newLayer.layerType === "text" || newLayer.layerType === "pose" ) )
            //if( ! (newLayer.layerType === "paint" || newLayer.layerType === "text" || newLayer.layerType === "pose" ) )
              handleIsVisible = false;
            //if( selectedLayer !== newLayer ) isVisible = false;
            if( handleIsVisible === false ) nodeLinkSource.classList.add( "hidden" );
            else nodeLinkSource.classList.remove( "hidden" );

            //are the gen controls visible?
            let genControlsVisible = false;
            if( uiSettings.activeTool === "generate" ) genControlsVisible = true;

            //remove links
            nodeLinkSource.querySelectorAll( ".layer-node-tail" ).forEach( n => nodeLinkSource.removeChild( n ) );

            //remake links (if any)
            if( handleIsVisible === true && genControlsVisible === true ) {
              if( newLayer.nodeUplinks.size > 0 ) {
                if( selectedLayer === newLayer ) {
                  //just one dashed link
                  createNodeTail( null, true );
                } else {
                  //build any links on the current selected layer
                  const controlsPanel = document.querySelector( "#generative-controls-panel" ),
                    controlElements = document.querySelectorAll( ".image-input-control" );
                  searchForControlElements:
                  for( const controlElement of controlElements ) {
                    for( const { layerId, apiFlowName, controlName, width } of newLayer.nodeUplinks ) {
                      if( layerId === selectedLayer.layerId && controlsPanel.apiFlowName === apiFlowName && controlName === controlElement.controlName ) {
                        createNodeTail( controlElement, false, width );
                        continue searchForControlElements;
                      }
                    }
                  }
                }
              }
            }

          }
        },
        { tooltip: [ "Drag to Link Generative Input", "to-left","vertical-center" ] },
      )
    }


    //activate the layer
    if( ! doNotUpdate )
      selectLayer( newLayer );
  }

  if( layerType !== "_temp" ) {
    const historyEntry = {
      newLayer,
      stackIndex: layersStack.layers.indexOf( newLayer ),
      undo: () => {
        layersStack.layers.splice( historyEntry.stackIndex, 1 );
        //layerButton.parentElement.removeChild( layerButton );
        reorganizeLayerButtons();
      },
      redo: () => {
        layersStack.layers.splice( historyEntry.stackIndex, 0, historyEntry.newLayer );
        //if( layerSibling ) document.querySelector( "#layers-column" ).insertBefore( layerButton, layerSibling );
        //else document.querySelector( "#layers-column" ).appendChild( layerButton );
        reorganizeLayerButtons();
      }
    }
    recordHistoryEntry( historyEntry );

    uiSettings.unsavedChanges = true;

    if( ! doNotUpdate ) {
      reorganizeLayerButtons();
      UI.updateContext();
    }

  }
  return newLayer;
  
}

function reorganizeLayerButtons() {
  //we're going to remove and re-insert all our layerbuttons
  //making sure everything goes in its right group
  //hmm... I think... Our scroll shouldn't be affected? Much? I hope?
  //No, the scroll should be fine. If not, I'll fix it.

  //basically, we have these new properties:
  // layerDepth: this bumps the layer leftward and shrinks it, while also adding a white bar to the right.
  // for layerDepth > 1, the bump distance and # of bars grows. :-|

  let draggingButton = null;
  const draggingButtons = [ ...document.querySelectorAll( ".dragging-layer-button" ) ];
  if( draggingButtons.length > 1 ) {
    draggingButtons.forEach( db => {
      db.classList.remove( "dragging-layer-button" );
      db.style = "";
    } );
  }
  else if( draggingButtons.length === 1)
    draggingButton = draggingButtons[ 0 ];

  //pop all the buttons
  document.querySelectorAll( ".layer-button" ).forEach(
    lb => {
      if( lb === draggingButton ) return;
      lb.parentElement.removeChild( lb )
    }
  );

  const layersColumn = document.querySelector( "#layers-column" );

  //reinstall in order
  for( let i=layersStack.layers.length-1; i>=0; i-- ) {
    const layer = layersStack.layers[ i ];
    if( layer.layerType === "_temp" ) continue; //ommitted from list now, can remove line... theoretically...

    if( layer.layerButton.classList.contains( "dragging-layer-button" ) ) {
      uiContainer.appendChild( layer.layerButton );
      continue;
    }

    if( checkLayerInsideClosedGroup( layer ) ) continue;

    //set the layer icon
    const iconElement = layer.layerButton.querySelector( ".layer-type-icon" );
    let iconClassName = "layer-type-icon tooltip-holder " + layer.layerType;
    if( layer.layerType === "group" ) {
      if( layer.groupClosed === false ) iconClassName += " open";
    } else {
      iconClassName += " no-hover";
    }
    iconElement.className = iconClassName;

    if( layer.layerType === "group" && layer === selectedLayer ) {
      updateLayerGroupCoordinates( layer );
    }

    layersColumn.appendChild( layer.layerButton );
    const layerGroupDepth = Math.min( 5, getLayerGroupDepth( layer ) );
    if( layerGroupDepth > 0 ) {
      layer.layerButton.classList.add( "layer-in-group", "layer-group-depth-" + layerGroupDepth );
    }
    else layer.layerButton.classList.remove( "layer-in-group" );

    if( layer === selectedLayer ) layer.layerButton.classList.add( "active", "no-hover" );
    else layer.layerButton.classList.remove( "active", "no-hover" );

  }

}

//TODO: Add jsdoc description here (read about how to define layer types? Hmm. Maybe typedefs can be loose? IDK.)
function duplicateLayersAndRecordUndo( groupedLayers, organizeDuplicatesTogether = true ) {
  const copyMap = [], 
  historyEntries = [];

  //we're going to catch our historyEntries
  for( const layer of groupedLayers ) {
    let copy;
    if( organizeDuplicatesTogether === false && layer.layerType === "group" ) {
      //don't duplicate layer groups when inserting into current structure
      continue;
    }
    let historyEntry;
    if( organizeDuplicatesTogether === true ) {
      //adding all copies as siblings directly above the first layer, one by one
      //(this won't actually work though, because for layer groups, addCanvasLayer will put us inside the group)
      copy = addCanvasLayer( layer.layerType, layer.w, layer.h, groupedLayers[ 0 ], true );
      historyEntry = history.pop();
    } else {
      //adding each copy as a sibling directly above its copied layer
      copy = addCanvasLayer( layer.layerType, layer.w, layer.h, layer, true );
      historyEntry = history.pop();
    }
    //by altering the properties without registering a new undo, the creation undo is a copy
    let copyCount = 1;
    const sourceLayerName = layer.layerName.replace( / \(copy\s{0,1}\d*\)$/gmi, "");
    copy.layerName = sourceLayerName + ` (copy)`;
    while( layersStack.layers.find( l => ( l !== copy && l.layerName === copy.layerName ) ) )
      copy.layerName = sourceLayerName + ` (copy ${++copyCount})`;
    if( organizeDuplicatesTogether === false )
      copy.layerGroupId = layer.layerGroupId;
    //will set layerGroupId later for rest
    copy.groupCompositeUpToDate = false;
    copy.groupClosed = layer.groupClosed;
    copy.context.drawImage( layer.canvas, 0, 0 );
    if( layer.maskInitialized ) {
      copy.maskContext.drawImage( layer.maskCanvas, 0, 0 );
      copy.maskInitialized = true;
      flagLayerMaskChanged( copy );
    }
    flagLayerTextureChanged( copy );
    copy.setVisibility( layer.visible );
    copy.setOpacity( layer.opacity );
    copy.topLeft = [ ...layer.topLeft ];
    copy.topRight = [ ...layer.topRight ];
    copy.bottomLeft = [ ...layer.bottomLeft ];
    copy.bottomRight = [ ...layer.bottomRight ];
    copyMap.push( { layer, copy } );
    if( layer.layerType === "pose" ) {
      copy.rig = JSON.parse( JSON.stringify( layer.rig ) );
      renderLayerPose( copy );
    }
    //if( layer.layerType === "text" ) {}
    //if( layer.layerType === "vector" ) {}
    //steal and save the undo entry
    historyEntries.push( historyEntry );
  }

  if( organizeDuplicatesTogether === true ) {
    //match up the layergroup structures
    //I can't just directly copy the old layergroupids, because we have new layer groups
    //have to match each copied layer with the equivalent copy of a layer group
    for( let i=0; i<copyMap.length; i++ ) {
      const originalParentMap = copyMap.find( ({layer}) => layer.layerId === copyMap[ i ].layer.layerGroupId );
      //top-level layer's parent imitates source (this line will not execute during copy phase when organizeDuplicatesTogether===true)
      if( ! originalParentMap ) {
        copyMap[ i ].copy.layerGroupId = copyMap[ i ].layer.layerGroupId;
        continue;
      }
      copyMap[ i ].copy.layerGroupId = originalParentMap.copy.layerId;
    }

    //reorganize the layers so we're outside the top-level group
    //remove all our copies
    for( const {copy} of copyMap ) {
      layersStack.layers.splice( layersStack.layers.indexOf( copy ), 1 );
    }
    layersStack.layers.splice( layersStack.layers.indexOf( groupedLayers[ 0 ] )+1, 0, ...(copyMap.map(({copy})=>copy).reverse()) );

    //update our history entry stack indices (and we'll see if this works)
    for( const historyEntry of historyEntries ) {
      historyEntry.stackIndex = layersStack.layers.indexOf( historyEntry.newLayer );
    }

  }

  //build the superconglomerate undo
  const historyEntry = {
    historyEntries,
    undo: () => {
      for( let i = historyEntry.historyEntries.length-1; i>=0; i-- ) {
        historyEntry.historyEntries[ i ].undo();
      }
    },
    redo: () => {
      for( const entry of historyEntry.historyEntries )
        entry.redo();
    }
  }
  //In the end, we'll push out max 1 old undo history record. The math adds up.
  recordHistoryEntry( historyEntry );

  reorganizeLayerButtons();
  UI.updateContext();

  //return duplicated layers
  return copyMap.map( ({copy})=>copy );

}

function cutLayersToLassoAreas( layers, invert = false, recordUndo = false ) {
  const undoRecords = [];
  for( const layer of layers ) {
    const lassoLayer = getLassoLayerForLayer( layer, true );
    if( lassoLayer ) {
      lassoLayer.context.putImageData( lassoLayer.lassoImageData, 0, 0 );
      let originalImageData;
      if( recordUndo === true ) {
        originalImageData = layer.context.getImageData( 0,0, layer.w, layer.h );
      }
      let localInvert = lassoResources.invert;
      if( invert ) localInvert = !localInvert;
      const { context } = layer;
      context.save();
      if( localInvert === false ) context.globalCompositeOperation = "destination-out";
      else context.globalCompositeOperation = "destination-in";
      context.drawImage( lassoLayer.canvas, 0, 0 );
      context.restore();
      if( recordUndo === true ) {
        let finalImageData = context.getImageData( 0,0,layer.w,layer.h );
        undoRecords.push( [layer,originalImageData,finalImageData] );
      }
      flagLayerTextureChanged( layer );
    }
  }
  if( recordUndo === true ) {
    const historyEntry = {
      undoRecords,
      undo: () => {
        for( const [layer,originalImageData] of historyEntry.undoRecords ) {
          layer.context.putImageData( originalImageData, 0, 0 );
          flagLayerTextureChanged( layer );
        }
      },
      redo: () => {
        for( const [layer,,finalImageData] of historyEntry.undoRecords ) {
          layer.context.putImageData( finalImageData, 0, 0 );
          flagLayerTextureChanged( layer );
        }
      }
    };
    recordHistoryEntry( historyEntry );
  }
}

//after sampleLayerInLayer, we'll swap out the img2img pull code with sampling like this
function sampleLayerInLayer( sourceLayer, rectLayer, compositingLayer, backgroundColorStyle = null ) {

  //match our compositingLayer to the rectLayer
  compositingLayer.canvas.width = rectLayer.w;
  compositingLayer.canvas.height = rectLayer.h;

  //get our rectLayer's coordinate space
  let origin = { x:rectLayer.topLeft[0], y:rectLayer.topLeft[1] },
    xLeg = { x:rectLayer.topRight[0] - origin.x, y: rectLayer.topRight[1] - origin.y },
    xLegLength = Math.sqrt( xLeg.x**2 + xLeg.y**2 ),
    normalizedXLeg = { x:xLeg.x/xLegLength, y:xLeg.y/xLegLength },
    yLeg = { x:rectLayer.bottomLeft[0] - origin.x, y: rectLayer.bottomLeft[1] - origin.y },
    yLegLength = Math.sqrt( yLeg.x**2 + yLeg.y**2 ),
    normalizedYLeg = { x:yLeg.x/yLegLength, y:yLeg.y/yLegLength };

  //cast sourceLayer's points to rectLayer's space
  let castPoints = {}
  for( const pointName of [ "topLeft", "topRight", "bottomLeft" ] ) {
    let [x,y] = sourceLayer[ pointName ];
    //translate from origin
    x -= origin.x; y -= origin.y;
    //project on normals
    let xProjection = x*normalizedXLeg.x + y*normalizedXLeg.y;
    let yProjection = x*normalizedYLeg.x + y*normalizedYLeg.y;
    //unnormalize
    xProjection *= rectLayer.w / xLegLength;
    yProjection *= rectLayer.h / yLegLength;
    castPoints[ pointName ] = { x:xProjection, y: yProjection }
  }

  //in this new space, get sourceLayer's axis legs
  const sourceTopLeg = { dx:castPoints.topRight.x - castPoints.topLeft.x, dy:castPoints.topRight.y - castPoints.topLeft.y },
    sourceToplegLength = Math.sqrt( sourceTopLeg.dx**2 + sourceTopLeg.dy**2 ),
    sourceSideLeg = { dx:castPoints.bottomLeft.x - castPoints.topLeft.x, dy:castPoints.bottomLeft.y - castPoints.topLeft.y },
    sourceSideLegLength = Math.sqrt( sourceSideLeg.dx**2 + sourceSideLeg.dy**2 );

  //in this new space, get sourceLayer's rotation
  const sourceRotation = Math.atan2( sourceTopLeg.dy, sourceTopLeg.dx );
  
  //draw to the compositing layer
  const ctx = compositingLayer.context;
  ctx.save();
  ctx.clearRect( 0,0,rectLayer.w,rectLayer.h );
  if( backgroundColorStyle !== null ) {
    ctx.fillStyle = backgroundColorStyle;
    ctx.fillRect( 0,0,rectLayer.w, rectLayer.h );
  }
  ctx.translate( castPoints.topLeft.x, castPoints.topLeft.y );
  ctx.rotate( sourceRotation );
  //ctx.scale( relativeScale, relativeScale );
  //draw image
  ctx.drawImage( sourceLayer.canvas, 0, 0, sourceToplegLength, sourceSideLegLength );
  //clip to mask
  if( sourceLayer.maskInitialized ) {
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage( sourceLayer.maskCanvas, 0, 0, sourceToplegLength, sourceSideLegLength );
  }
  //We don't care about destination layer's mask.
  //Even for layer merging, the mask does not go into the image URLs.
  ctx.restore();

  //compositingLayer now contains a snapshot of sourceLayer as it overlaps rectLayer

}

function updateLayerGroupComposite( layer ) {
  //You expect the layer group's resolution to be its visible relative resolution on-screen. And you expect its size to be determined by its contents.
  //We diverge from this behavior If and Only If you export a layer individually.

  const childLayers = layersStack.layers.filter( l => l.layerGroupId === layer.layerId );
  //console.error( "Layer group compositing is not checking for cyclical references." );
  for( const childLayer of childLayers )
    if( childLayer.layerType === "group" && ! childLayer.groupCompositeUpToDate )
      updateLayerGroupComposite( childLayer );

  //update
  //composeLayers( layer, childLayers, 1 );
  composeLayersGPU( layer, childLayers, 1 );
  //document.body.appendChild( layer.canvas );
  //layer.canvas.style = "position:absolute; left:10px; top:10px; width:100px; border:1px solid red; z-index:9999999999;";
}

function updateLayerGroupCoordinates( layerGroup ) {
  if( layerGroup.layerType !== "group" ) return;

  const layersInGroup = collectGroupedLayersAsFlatList( layerGroup.layerId );

  if( layersInGroup.length === 0 ) return;

  let minX = Infinity, minY = Infinity,
    maxX = -Infinity, maxY = -Infinity;
  for( const groupedLayer of layersInGroup ) {
    if( groupedLayer.layerType === "group" ) continue;
    for( const p of ["topLeft","topRight","bottomLeft","bottomRight"] ) {
      minX = Math.min(minX,groupedLayer[p][0]);
      minY = Math.min(minY,groupedLayer[p][1]);
      maxX = Math.max(maxX,groupedLayer[p][0]);
      maxY = Math.max(maxY,groupedLayer[p][1]);
    }
  }

  minX = minX;
  minY = minY;
  maxX = maxX;
  maxY = maxY;

  //update the rect
  layerGroup.topLeft[0] = minX;
  layerGroup.topLeft[1] = minY;
  layerGroup.topRight[0] = maxX;
  layerGroup.topRight[1] = minY;
  layerGroup.bottomLeft[0] = minX;
  layerGroup.bottomLeft[1] = maxY;
  layerGroup.bottomRight[0] = maxX;
  layerGroup.bottomRight[1] = maxY;

}

let selectionChanged = false;
function declareSelectionChanged() {
  selectionChanged = true;
}
function getSelectedOrBatchedLayers( includeGroupLayers = false ) {
  if( ! getSelectedOrBatchedLayers.selectedAndBatchedLayers ) {
    getSelectedOrBatchedLayers.selectedAndBatchedLayers = [];
    selectionChanged = true;
  }
  if( selectionChanged === false ) {
    return getSelectedOrBatchedLayers.selectedAndBatchedLayers;
  }
  const selectedAndBatchedLayers = getSelectedOrBatchedLayers.selectedAndBatchedLayers;
  selectedAndBatchedLayers.length = 0;
  if( batchedLayers.size ) {
    if( includeGroupLayers === false ) {
      const nonGroupBatchedLayers = [];
      for( const layer of batchedLayers ) {
        if( layer.layerType === "group" ) continue;
        nonGroupBatchedLayers.push( layer );
      }
      selectedAndBatchedLayers.push( ...nonGroupBatchedLayers );
    } else {
      selectedAndBatchedLayers.push( ...batchedLayers );
    }
  }
  //selected layer and batchedlayers should be exclusively populated (theoretically...)
  //which means we shouldn't end up with duplicates in selectedAndBatchedLayers
  else if( selectedLayer?.layerType === "group" ) {
    const groupChildren = collectGroupedLayersAsFlatList( selectedLayer.layerId );
    if( includeGroupLayers === false ) {
      const nonGroupChildren = [];
      for( const layer of groupChildren ) {
        if( layer.layerType === "group" ) continue;
        nonGroupChildren.push( layer );
      }
      selectedAndBatchedLayers.push( ...nonGroupChildren );
    }
    else {
      selectedAndBatchedLayers.push( ...groupChildren );
    }
  }
  else if( selectedLayer ) {
    selectedAndBatchedLayers.push( selectedLayer );
  }
  //check our top-most layer first
  selectedAndBatchedLayers.sort( (a,b) => ( layersStack.layers.indexOf(a) < layersStack.layers.indexOf(b) ) ? 1 : -1 );

  selectionChanged = false;

  return selectedAndBatchedLayers;

}

function getSelectedOrBatchedLayerContainingPoint( point ) {

  const selectedAndBatchedLayers = getSelectedOrBatchedLayers();

  //collect active / relevant layers
  let layerContainingPoint = null;
  for( const layer of selectedAndBatchedLayers ) {
    if( testPointsInLayer( layer, [point], true ) ) {
      layerContainingPoint = layer;
      break;
    }
  }

  return { selectedAndBatchedLayers, layerContainingPoint };

}

function testPointsInLayer( layer, testPoints, screenSpacePoints = false ) {

  const points = [];
  for( const point of testPoints )
    points.push( [ ...point ] );

  if( screenSpacePoints === true ) {
    //get screen->global space inversion
    _originMatrix[ 2 ] = -view.origin.x;
    _originMatrix[ 5 ] = -view.origin.y;
    _positionMatrix[ 2 ] = view.origin.x;
    _positionMatrix[ 5 ] = view.origin.y;

    mul3x3( viewMatrices.current , _originMatrix , _inverter );
    mul3x3( _inverter , viewMatrices.moving , _inverter );
    mul3x3( _inverter , _positionMatrix , _inverter );
    inv( _inverter , _inverter );

    for( const point of points ){
      mul3x1( _inverter, point, point );
    }
  }

  //if our layer is a group, make sure we have its rect right
  if( layer.layerType === "group" ) {
    updateLayerGroupCoordinates( layer );
  }

  //get our selected layer's space
  let origin = { x:layer.topLeft[0], y:layer.topLeft[1] },
    xLeg = { x:layer.topRight[0] - origin.x, y: layer.topRight[1] - origin.y },
    xLegLength = Math.sqrt( xLeg.x**2 + xLeg.y**2 ),
    normalizedXLeg = { x:xLeg.x/xLegLength, y:xLeg.y/xLegLength },
    yLeg = { x:layer.bottomLeft[0] - origin.x, y: layer.bottomLeft[1] - origin.y },
    yLegLength = Math.sqrt( yLeg.x**2 + yLeg.y**2 ),
    normalizedYLeg = { x:yLeg.x/yLegLength, y:yLeg.y/yLegLength };

  let pointInLayer = false;

  //cast global points to our selected layer's space
  for( const point of points ) {
    let [x,y] = point;
    //translate from origin
    x -= origin.x; y -= origin.y;
    //project on normals
    let xProjection = x*normalizedXLeg.x + y*normalizedXLeg.y;
    let yProjection = x*normalizedYLeg.x + y*normalizedYLeg.y;
    //unnormalize
    xProjection *= layer.w / xLegLength;
    yProjection *= layer.h / yLegLength;
    //check if the point is inside the layer bounds
    if( xProjection >= 0 && xProjection <= layer.w && yProjection >= 0 && yProjection <= layer.h ) {
      pointInLayer = true;
      break;
    }
  }

  return pointInLayer;

}

function floodFillLayer( layer, layerX, layerY ) {

  //get the layer's data
  const imageData = layer.context.getImageData( 0, 0, layer.w, layer.h );
  //get the layer's lasso mask
  const lassoArea = getLassoLayerForLayer( layer, true );
  const lassoData = lassoArea ? lassoArea.lassoImageData.data : null;
  const invertLasso = lassoResources.invert;
  //create a storage buffer
  const island = new Uint8ClampedArray( imageData.data.length / 4 );

  
  //get color
  let lr,lg,lb,la;
  {
    let x = layerX,
      y = layerY * layer.w,
      i = ( y + x ) * 4;
    lr = imageData.data[ i+0 ];
    lg = imageData.data[ i+1 ];
    lb = imageData.data[ i+2 ];
    la = imageData.data[ i+3 ];
    //set our island pixel
    island[ i / 4 ] = 255;
  }

  let { tolerance, floodTarget, padding, erase } = uiSettings.toolsSettings[ "flood-fill" ];
  tolerance *= Math.sqrt( 255**2 * 4 );
  const [ r,g,b ] = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes[uiSettings.toolsSettings.paint.modeSettings.brush.colorMode ].getRGB();
  //const a = uiSettings.toolsSettings.paint.modeSettings.all.brushOpacity;

  const {w,h} = layer;
  const d = imageData.data;

  let minX = w,
    minY = h,
    maxX = 0,
    maxY = 0;
  
  if( floodTarget === "area" ) {

      //edge marching doesn't work. :-/ We have to do crawling.
      const crawledPixels = [ [ layerX, layerY ] ];

      //turn this into a 1-deep loop

      while( crawledPixels.length !== 0 ) {
        let [x,y] = crawledPixels.pop(),
          i = ((y*w)+x) * 4,
          dr, dg, db, da,
          dist;
        
        let sa = 255;

        if( lassoData ) {
          if( ( ( ! invertLasso ) && lassoData[ i + 3 ] === 0 ) || ( invertLasso && lassoData[ i + 3 ] === 255 ) ) continue;
          sa = invertLasso ? 255 - lassoData[ i + 3 ] : lassoData[ i + 3 ];
        }

        //to the left
        i = ((y*w)+x-1) * 4;
        if( island[ i/4 ] === 0 ) {
          dr = d[ i ] - lr; dg = d[ i+1 ] - lg; db = d[ i+2 ] - lb; da = d[ i+3 ] - la;
          dist = Math.sqrt( dr**2 + dg**2 + db**2 + da**2 );
          if( dist < tolerance ) {
            if( erase ) d[ i+3 ] = 0;
            else { d[ i ] = r; d[ i+1 ] = g; d[ i+2 ] = b; d[ i+3 ] = sa; }
            crawledPixels.push( [x-1,y] );
            island[ i/4 ] = 255;
            minX = Math.min( minX, x-1 );
            maxX = Math.max( maxX, x-1 );
            minY = Math.min( minY, y );
            maxY = Math.max( maxY, y );
          }
        }

        //to the right
        i = ((y*w)+x+1) * 4;
        if( island[ i/4 ] === 0 ) {
          dr = d[ i ] - lr; dg = d[ i+1 ] - lg; db = d[ i+2 ] - lb; da = d[ i+3 ] - la;
          dist = Math.sqrt( dr**2 + dg**2 + db**2 + da**2 );
          if( dist < tolerance ) {
            if( erase ) d[ i+3 ] = 0;
            else { d[ i ] = r; d[ i+1 ] = g; d[ i+2 ] = b; d[ i+3 ] = sa; }
            crawledPixels.push( [x+1,y] );
            island[ i/4 ] = 255;
            minX = Math.min( minX, x+1 );
            maxX = Math.max( maxX, x+1 );
            minY = Math.min( minY, y );
            maxY = Math.max( maxY, y );
          }
        }

        //to the top
        i = (((y-1)*w)+x) * 4;
        if( island[ i/4 ] === 0 ) {
          dr = d[ i ] - lr; dg = d[ i+1 ] - lg; db = d[ i+2 ] - lb; da = d[ i+3 ] - la;
          dist = Math.sqrt( dr**2 + dg**2 + db**2 + da**2 );
          if( dist < tolerance ) {
            if( erase ) d[ i+3 ] = 0;
            else { d[ i ] = r; d[ i+1 ] = g; d[ i+2 ] = b; d[ i+3 ] = sa; }
            crawledPixels.push( [x,y-1] );
            island[ i/4 ] = 255;
            minX = Math.min( minX, x );
            maxX = Math.max( maxX, x );
            minY = Math.min( minY, y-1 );
            maxY = Math.max( maxY, y-1 );
          }
        }

        //to the bottom
        i = (((y+1)*w)+x) * 4;
        if( island[ i/4 ] === 0 ) {
          dr = d[ i ] - lr; dg = d[ i+1 ] - lg; db = d[ i+2 ] - lb; da = d[ i+3 ] - la;
          dist = Math.sqrt( dr**2 + dg**2 + db**2 + da**2 );
          if( dist < tolerance ) {
            if( erase ) d[ i+3 ] = 0;
            else { d[ i ] = r; d[ i+1 ] = g; d[ i+2 ] = b; d[ i+3 ] = sa; }
            crawledPixels.push( [x,y+1] );
            island[ i/4 ] = 255;
            minX = Math.min( minX, x );
            maxX = Math.max( maxX, x );
            minY = Math.min( minY, y+1 );
            maxY = Math.max( maxY, y+1 );
          }
        }
        
      }

  }
  if( floodTarget === "color" ) {
    //for each pixel, get distance from lrlglbla
    //if( dist < tolerance ): replace pixel w/ erase, update min*
    for( let i=0; i<d.length; i+=4 ) {

      let sa = 255;

      if( lassoData ) {
        if( ( ( ! invertLasso ) && lassoData[ i + 3 ] === 0 ) || ( invertLasso && lassoData[ i + 3 ] === 255 ) ) continue;
        sa = invertLasso ? 255 - lassoData[ i + 3 ] : lassoData[ i + 3 ];
      }

      const dr = d[ i ] - lr, dg = d[ i+1 ] - lg, db = d[ i+2 ] - lb, da = d[ i+3 ] - la;
      const dist = Math.sqrt( dr**2 + dg**2 + db**2 + da**2 );
      if( dist < tolerance ) {
        if( erase ) d[ i+3 ] = 0;
        else { d[ i ] = r; d[ i+1 ] = g; d[ i+2 ] = b; d[ i+3 ] = sa; }
        const x = ( i/4 ) % w,
          y = ( i/4 - x ) / w; //this is untested for float errors vs. parseInt, but for min* it should work
        island[ i/4 ] = 255;
        minX = Math.min( minX, x );
        maxX = Math.max( maxX, x );
        minY = Math.min( minY, y );
        maxY = Math.max( maxY, y );
      }
    }
  }

  if( padding > 0 ) {
    //for every pixel, if it's not an island pixel, scan within padding radius for an island pixel
    //if found, break and treat the pixel
    const maxPad = ( parseInt( padding ) + 1 ),
      minPad = - maxPad,
      padding2 = padding**2;

    //CPU optimized, still far too slow at 10px padding. :-/ Need to move to GPU. (Not a priority.)
    padPixelSearch:
    for( let i=0,j=0, py=0, px=0; i<d.length; ) {

      let sa = 255;

      if( lassoData ) {
        if( ( ( ! invertLasso ) && lassoData[ i + 3 ] === 0 ) || ( invertLasso && lassoData[ i + 3 ] === 255 ) ) continue;
        sa = invertLasso ? 255 - lassoData[ i + 3 ] : lassoData[ i + 3 ];
      }

      if( island[ j ] === 255 ) {
        //pixel already filled
        i += 4;
        j += 1;
        continue padPixelSearch;
      }

      let pj = ( j + px ) + ( py * w );

      if(
        ( pj < 0 || pj >= island.length ) ||
        ( island[ pj ] === 0 ) ||
        ( ( px**2 + py**2 ) > padding2 )
      ) {
        //continue searching for a filled pixel inside the pad zone
        if( px === maxPad && py === maxPad ) {
          px = minPad;
          py = minPad;
          i += 4;
          j += 1;
        }
        else if( py === maxPad ) {
          py = minPad;
          px += 1;
        }
        else {
          py += 1;
        }
      }
      else {
        //found a filled pixel inside the pad zone

        //erase or fill
        if( erase ) d[ i+3 ] = 0;
        else { d[ i ] = r; d[ i+1 ] = g; d[ i+2 ] = b; d[ i+3 ] = sa; }

        //update rect
        const x = j % w, y = ( j - x ) / w;
        minX = Math.min( minX, x );
        maxX = Math.max( maxX, x );
        minY = Math.min( minY, y );
        maxY = Math.max( maxY, y );

        //reset pad-scan and advance to next pixel
        px = minPad;
        py = minPad;
        i += 4;
        j += 1;
        continue padPixelSearch;
      }

    }

  }

  const changedRect = {
    x: minX - 1,
    y: minY - 1,
    w: maxX - minX + 2,
    h: maxY - minY + 2
  }

  //get the old data
  const oldData = layer.context.getImageData( changedRect.x, changedRect.y, changedRect.w, changedRect.h );

  //blit the flood fill
  layer.context.putImageData( imageData, 0, 0 );

  //get the new data
  const newData = layer.context.getImageData( changedRect.x, changedRect.y, changedRect.w, changedRect.h );

  const historyEntry = {
    layer,
    oldData,
    newData,
    changedRect,
    undo: () => {
      historyEntry.layer.context.putImageData( historyEntry.oldData, historyEntry.changedRect.x, historyEntry.changedRect.y );
      flagLayerTextureChanged( layer, historyEntry.changedRect );
    },
    redo: () => {
      historyEntry.layer.context.putImageData( historyEntry.newData, historyEntry.changedRect.x, historyEntry.changedRect.y );
      flagLayerTextureChanged( layer, historyEntry.changedRect );
    }
  }

  recordHistoryEntry( historyEntry );

  flagLayerTextureChanged( layer, changedRect );

}

function renderLayerText( layer ) {

}

const gradientGPUResources = {
  gradientShapes: {},
}
function setupRenderGradientGPU(){}
function renderGradientGPU( layer, gradientShape ) {
  if( ! gradientGPUResources.gradientShapes.has( gradientShape.shapeId ) ) {
    //create the gradient shape's databuffers
  }
  //update gradient shape's databuffers
  //render to layer's texture
}
function renderLayerVector( layer ) {
  for( const vector of layer.vectors ) {
    if( vector.vectorType === "line" ) {}
    if( vector.vectorType === "bezier" ) {}
    if( vector.vectorType === "quadratic" ) {}
    if( vector.vectorType === "ellipse" ) {}
    if( vector.vectorType === "rect" ) {}
  }
}

function renderLayerPose( layer ) {
  const rig = layer.rig;
  const ctx = layer.context,
    { w,h } = layer;
  //ctx.fillStyle = "rgb(0,0,0)";
  //ctx.fillRect( 0,0,w,h );
  ctx.clearRect( 0,0,w,h );
  //draw the node links
  const nodes = Object.values( rig );
  for( const node of nodes ) {
    if( ! node.parentLink ) continue;
    const [r,g,b] = node.parentLink.color;
    const parent = nodes.find( n => n.name === node.parentLink.parentName );
    const x = ( node.x + parent.x ) / 2, y = ( node.y + parent.y ) / 2;
    const vectorX = parent.x - node.x, vectorY = parent.y - node.y;
    const rotation = Math.atan2( vectorY, vectorX );
    const length = Math.sqrt( vectorX**2 + vectorY**2 );
    ctx.save();
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.translate( x,y );
    ctx.rotate( rotation );
    ctx.scale( length/18, 1 );
    ctx.beginPath();
    ctx.arc( 0,0,9,0,6.284,false );
    ctx.fill();
    ctx.restore();
  }
  for( const node of nodes ) {
    const { x,y, color } = node;
    const [r,g,b] = color;
    ctx.save();
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.translate( x,y );
    ctx.beginPath();
    ctx.arc( 0,0,9,0,6.284,false );
    ctx.fill();
    ctx.restore();
  }
  flagLayerTextureChanged( layer );
}

function composeLayersGPU( destinationLayer, layers, zoomScale=1, ignoreVisibility=false ) {
  
  const visibleLayers = [];
  if( ignoreVisibility === false ) {
    for( const layer of layers )
      if( getLayerVisibility( layer ) === true )
        visibleLayers.push( layer );
  }
  else visibleLayers.push( ...layers );

  let minX = Infinity, minY = Infinity,
    maxX = -Infinity, maxY = -Infinity;
  for( const layer of visibleLayers ) {
    for( const p of ["topLeft","topRight","bottomLeft","bottomRight"] ) {
      minX = Math.min(minX,layer[p][0]);
      minY = Math.min(minY,layer[p][1]);
      maxX = Math.max(maxX,layer[p][0]);
      maxY = Math.max(maxY,layer[p][1]);
    }
  }

  minX = parseInt( Math.round( minX ) );
  minY = parseInt( Math.round( minY ) );
  maxX = parseInt( Math.round( maxX ) );
  maxY = parseInt( Math.round( maxY ) );

  const width = parseInt( ( maxX - minX ) * zoomScale ),
    height = parseInt( ( maxY - minY ) * zoomScale );

  //prep our width and height
  destinationLayer.canvas.width = width;
  destinationLayer.canvas.height = height;
  destinationLayer.w = width;
  destinationLayer.h = height;

  destinationLayer.topLeft = [minX,minY,1];
  destinationLayer.topRight = [maxX,minY,1];
  destinationLayer.bottomLeft = [minX,maxY,1];
  destinationLayer.bottomRight = [maxX,maxY,1];
  
  //simple transform, load manually
  //const saveTransformMatrix = [ ..._transform ];
  //_transform.length = 0;
  //_transform.push(zoomScale, 0, -minX, 0, zoomScale, -minY, 0, 0, 1 );

  //render to the texture
  //renderLayers( visibleLayers, [], 0, destinationLayer, [0,0,0,0], false, false );
  renderLayersIntoPointRect( destinationLayer, visibleLayers, [], 0, destinationLayer, [0,0,0,0], false, false );

  //restore our transform (probably not necessary, we trash this every cycle)
  //_transform.length = 0;
  //_transform.push( ...saveTransformMatrix );

  //prep our array
  //(pixels pulled in render function)
  if( false ) {
    const composedData = new Uint8Array( width * height * 4 );
    gl.readPixels( 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, composedData );
  
    //transfer to the destination canvas
    const writeCompose = destinationLayer.context.createImageData( width, height );
    writeCompose.data.set( composedData );
    destinationLayer.context.putImageData( writeCompose, 0, 0 );  
  }
}

function composeLayers( destinationLayer, layers, pixelScale=1, ignoreVisibility=false ) {

  const visibleLayers = [];
  if( ignoreVisibility === false ) {
    for( const layer of layers )
      if( getLayerVisibility( layer ) === true )
        visibleLayers.push( layer );
  }
  else visibleLayers.push( ...layers );

  let minX = Infinity, minY = Infinity,
    maxX = -Infinity, maxY = -Infinity;
  for( const layer of visibleLayers ) {
    for( const p of ["topLeft","topRight","bottomLeft","bottomRight"] ) {
      minX = Math.min(minX,layer[p][0]);
      minY = Math.min(minY,layer[p][1]);
      maxX = Math.max(maxX,layer[p][0]);
      maxY = Math.max(maxY,layer[p][1]);
    }
  }

  minX = parseInt( minX );
  minY = parseInt( minY );
  maxX = parseInt( maxX ) + 1;
  maxY = parseInt( maxY ) + 1;

  const width = parseInt( ( maxX - minX ) * pixelScale ),
    height = parseInt( ( maxY - minY ) * pixelScale );

  destinationLayer.canvas.width = width;
  destinationLayer.canvas.height = height;
  
  const ctx = destinationLayer.context;
  ctx.save();
  //translate so our minXY is at 0
  ctx.translate( -minX, -minY );
  //draw our layers
  for( const layer of visibleLayers ) {
      const [x,y] = layer.topLeft,
        [x2,y2] = layer.topRight;
      const dx = x2-x, dy=y2-y;
      const l = Math.sqrt( dx*dx + dy*dy );
      ctx.save();
      ctx.translate( x, y );
      ctx.rotate( Math.atan2( dy, dx ) );
      ctx.scale( l / layer.w, l / layer.w );
      ctx.globalAlpha = layer.opacity;
      if( layer.maskInitialized === true ) {
        //if our layer is masked, clip it
        destinationLayer.maskCanvas.width = layer.w;
        destinationLayer.maskCanvas.height = layer.h;
        const maskingContext = destinationLayer.maskContext;
        maskingContext.save();
        maskingContext.globalCompositeOperation = "copy";
        maskingContext.drawImage( layer.maskCanvas, 0, 0 );
        maskingContext.globalCompositeOperation = "source-in";
        maskingContext.drawImage( layer.canvas, 0, 0 );
        maskingContext.restore();
        ctx.drawImage( destinationLayer.maskCanvas, 0, 0 );
      }
      else if( layer.maskInitialized === false ) {
        ctx.drawImage( layer.canvas, 0, 0 );
      }
      ctx.restore();
  }

  ctx.restore();
  
}

//filter functions should execute in an iframe[about:blank] -> off-main thread
//  - pass back and forth w,h,imageData[u8*]
//  - to avoid performance penalty, some will render here on the main thread
//  - may also have GLSL filters? IDK

function renderStandardFilterLayer( layer ) {
  if( layer.filteringLayerId === null ) return;
  if( layer.filterSettings.filterName !== "standard" ) return;
  const ctx = layer.context;
  //find the filtered layer
  const filteredLayer = layersStack.layers.find( l => l.layerId === layer.filteringLayerId );
  if( ! filteredLayer ) {
    ctx.clearRect( 0, 0, layer.w, layer.h )
    layer.filteringLayerId = null;
    flagLayerTextureChanged( layer );
    return;
  }

  let w = filteredLayer.w, h = filteredLayer.h,
    x = 0, y = 0;
  const formats = {
    "blur": px => `blur(${px}px)`,
    "brightness": b => `brightness(${b}%)`,
    "contrast": c => `contrast(${c}%)`,
    //"drop-shadow": ({x,y,blur,color}) => `contrast(${x}px ${y}px ${blur}px ${color})`,
    "grayscale": g => `grayscale(${g}%)`,
    "hue-rotate": r => `hue-rotate(${r}turn)`,
    "invert": i => `invert(${i}%)`,
    "saturation": i => `saturate(${i}%)`
    //"sepia": i => `sepia(${i}%)`, //needs to be applied in order?
  };

  const filterComponents = [];
  //this needs to be looping thru controls.
  //might have multiples, and order matters
  for( const key in formats ) {
    const { value, defaultValue } = layer.filterControls[ layer.filterSettings.filterName ];
    if( value === defaultValue ) continue;
    filterComponents.push( formats[ key ]( value ) );
    if( key === "blur" ) {
      w += 2*value;
      h += 2*value;
      x = value;
      y = value;
    }
  }

  if( layer.w !== w || layer.h !== h ) {
    resetLayerSizeAndClear( layer, w, h );
  }

  const mtx = layer.maskContext;
  mtx.clearRect( 0,0,w,h );
  mtx.save();
  mtx.drawImage( filteredLayer.canvas, x, y );
  if( filteredLayer.maskInitialized ) {
    mtx.globalCompositeOperation = "destination-in";
    mtx.drawImage( filteredLayer.mask, x, y );
  }
  mtx.restore();

  ctx.clearRect( 0,0,w,h );
  ctx.filter = filterComponents.join( " " );
  ctx.drawImage( layer.maskCanvas, 0, 0 );
  mtx.clearRect( 0,0,w,h ); //not ideal, since now we can't mask filters. Can we draw a canvas to itself? Probably???
  flagLayerTextureChanged( layer );

}

function flagLayerFilterChanged( layer ) {
  //look for filters pulling this layer.
  const filters = layersStack.layers.filter( l => l.layerType === "filter" && l.filteringLayerId === layer.layerId );
  for( const filter of filters ) {
    renderStandardFilterLayer( filter );
  }
}
function flagLayerGroupChanged( layer ) {
  let groupChainLayer = layer;
  while( groupChainLayer.layerGroupId !== null ) {
    const groupLayer = layersStack.layers.find( l => l.layerId ===groupChainLayer.layerGroupId )
    //if( ! groupLayer ) { console.error( "Layer missing declared group: ", groupChainLayer ); }
    groupLayer.groupCompositeUpToDate = false;
    flagLayerFilterChanged( groupLayer );
    groupChainLayer = groupLayer;
  }
}
function flagLayerTextureChanged( layer, rect=null, updateFrame=true ) {
  layer.textureChanged = true;
  if( rect === null ) {
    layer.textureChangedRect.x = 0;
    layer.textureChangedRect.y = 0;
    layer.textureChangedRect.w = layer.w;
    layer.textureChangedRect.h = layer.h;
  } else {
    layer.textureChangedRect.x = rect.x;
    layer.textureChangedRect.y = rect.y;
    layer.textureChangedRect.w = rect.w;
    layer.textureChangedRect.h = rect.h;
  }
  //resave layer
  if( updateFrame === true ) updateAndMakeLayerFrame( layer );
  flagLayerGroupChanged( layer );
  flagLayerFilterChanged( layer );
  uiSettings.unsavedChanges = true;
}
function flagLayerMaskChanged( layer, rect=null ) {
  layer.maskChanged = true;
  if( rect === null ) {
    layer.maskChangedRect.x = 0;
    layer.maskChangedRect.y = 0;
    layer.maskChangedRect.w = layer.w;
    layer.maskChangedRect.h = layer.h;
  } else {
    layer.maskChangedRect.x = rect.x;
    layer.maskChangedRect.y = rect.y;
    layer.maskChangedRect.w = rect.w;
    layer.maskChangedRect.h = rect.h;
  }
  flagLayerGroupChanged( layer );
  flagLayerFilterChanged( layer );
  uiSettings.unsavedChanges = true;
}

function collectGroupedLayersAsFlatList( groupLayerId ) {
  const collectedLayers = [];
  let groupIdsToCheck = [ groupLayerId ];
  while( groupIdsToCheck.length > 0 ) {
    const groupId = groupIdsToCheck.pop();
    for( const layer of layersStack.layers ) {
      if( layer.layerGroupId === groupId ) {
        collectedLayers.push( layer );
        if( layer.layerType === "group" ) {
          groupIdsToCheck.push( layer.layerId );
        }
      }
    }
  }
  return collectedLayers;
}

function getLayerGroupChain( layer ) {
  const groupChain = [ layer.layerGroupId ];
  while( layer.layerGroupId !== null ) {
    layer = layersStack.layers.find( l => l.layerId === layer.layerGroupId );
    groupChain.push( layer.layerGroupId )
  }
  return groupChain; //groupChain should always end in null probably
}

function checkLayerInsideClosedOrNonVisibleGroup( layer ) {
  if( layer.visible === false ) return true;
  if( !layer || layer.layerGroupId === null ) return false;
  let groupLayer = layersStack.layers.find( l => l.layerId === layer.layerGroupId );
  if( groupLayer.groupClosed === true || groupLayer.visible === false ) return true;
  return checkLayerInsideClosedGroup( groupLayer );
}

function checkLayerInsideClosedGroup( layer ) {
  if( !layer || layer.layerGroupId === null ) return false;
  let groupLayer = layersStack.layers.find( l => l.layerId === layer.layerGroupId );
  if( groupLayer.groupClosed === true ) return true;
  return checkLayerInsideClosedGroup( groupLayer );
}

function getLayerGroupDepth( layer ) {
  if( !layer || layer.layerGroupId === null ) return 0;
  return 1 + getLayerGroupDepth( layersStack.layers.find( l => l.layerId === layer.layerGroupId ) );
}

function existsVisibleLayer() {
  for( const layer of layersStack.layers ) {
    if( layer.layerType === "_temp" ) continue;
    if( layer.layerType === "group" ) continue;
    if( getLayerVisibility( layer ) ) return true;
  }
  return false;
}
function getLayerVisibility( layer ) {
  if( ! layer ) {return false;}
  if( layer.layerType === "_temp" ) {return false;}
  if( layer.visible === false ) {return false;}
  if( layer.layerGroupId === null ) {return true;}
  const parentLayer = layersStack.layers.find( l => l.layerId === layer.layerGroupId );
  return getLayerVisibility( parentLayer );
}
function getLayerOpacity( layer ) {
  let alpha = layer.opacity;
  if( layer.layerGroupId === null ) return alpha;
  return alpha * getLayerOpacity( layersStack.layers.find( l => l.layerId === layer.layerGroupId ) );
}

function clearDataCache( layer ) {
  layer.dataCache.length = 0;
}
function buildDataCache( layer ) {
  clearDataCache( layer );
  layer.dataCache.push( layer.context.getImageData( 0, 0, layer.w, layer.h ) );
  if( layer.maskInitialized ) layer.dataCache.push( layer.maskContext.getImageData( 0,0,layer.w,layer.h ) );
}

async function resetLayerSizeAndClear( layer, width, height ) {
  if( layer.dataCache.length ) clearDataCache( layer );

  const widthScale = width / layer.w,
    heightScale = height / layer.h;

  layer.canvas.width = layer.maskCanvas.width = layer.w = width;
  layer.canvas.height = layer.maskCanvas.height = layer.h = height;
  
  const tl = layer.topLeft,
    tr = layer.topRight,
    bl = layer.bottomLeft,
    br = layer.bottomRight;
  
  //resize width vectors
  const topCenter = [ (tl[0]+tr[0])/2, (tl[1]+tr[1])/2 ],
    bottomCenter = [ (bl[0]+br[0])/2, (bl[1]+br[1])/2 ];

  for( const [points,center] of [ [[tl,tr],topCenter], [[bl,br],bottomCenter] ]) {
    for( const point of points ) {
      point[0] = ((point[0]-center[0]) * widthScale)+center[0];
      point[1] = ((point[1]-center[1]) * widthScale)+center[1];
    }
  }

  //resize height vectors
  const leftCenter = [ (tl[0]+bl[0])/2, (tl[1]+bl[1])/2 ],
    rightCenter = [ (tr[0]+br[0])/2, (tr[1]+br[1])/2 ];

  for( const [points,center] of [ [[tl,bl],leftCenter], [[tr,br],rightCenter] ]) {
    for( const point of points ) {
      point[0] = ((point[0]-center[0]) * heightScale)+center[0];
      point[1] = ((point[1]-center[1]) * heightScale)+center[1];
    }
  }

  flagLayerTextureChanged( layer );
  flagLayerMaskChanged( layer );
  layer.maskInitialized = false;

}

async function cropLayerSizeAndRecordUndo( layer, width, height, x=null, y=null ) {

  buildDataCache( layer );

  const oldData = {
    topLeft: [...layer.topLeft],
    topRight: [...layer.topRight],
    bottomLeft: [...layer.bottomLeft],
    bottomRight: [...layer.bottomRight],
    w: layer.w,
    h: layer.h,
    x: 0,
    y: 0,
    canvasData: layer.dataCache[0],
    maskData: layer.dataCache[1], //may be undefined
  }

  const widthScale = width / layer.w,
    heightScale = height / layer.h;

  if( x === null ) x = parseInt( ( width - layer.dataCache[0].width ) / 2 );
  if( y === null ) y = parseInt( ( height - layer.dataCache[0].height ) / 2 );

  layer.canvas.width = layer.maskCanvas.width = layer.w = width;
  layer.canvas.height = layer.maskCanvas.height = layer.h = height;
  
  const tl = layer.topLeft,
    tr = layer.topRight,
    bl = layer.bottomLeft,
    br = layer.bottomRight;
  
  //resize width vectors
  const topCenter = [ (tl[0]+tr[0])/2, (tl[1]+tr[1])/2 ],
    bottomCenter = [ (bl[0]+br[0])/2, (bl[1]+br[1])/2 ];

  for( const [points,center] of [ [[tl,tr],topCenter], [[bl,br],bottomCenter] ]) {
    for( const point of points ) {
      point[0] = ((point[0]-center[0]) * widthScale)+center[0];
      point[1] = ((point[1]-center[1]) * widthScale)+center[1];
    }
  }

  //resize height vectors
  const leftCenter = [ (tl[0]+bl[0])/2, (tl[1]+bl[1])/2 ],
    rightCenter = [ (tr[0]+br[0])/2, (tr[1]+br[1])/2 ];

  for( const [points,center] of [ [[tl,bl],leftCenter], [[tr,br],rightCenter] ]) {
    for( const point of points ) {
      point[0] = ((point[0]-center[0]) * heightScale)+center[0];
      point[1] = ((point[1]-center[1]) * heightScale)+center[1];
    }
  }

  layer.context.putImageData( layer.dataCache[ 0 ], x, y );
  if( layer.maskInitialized ) layer.maskContext.putImageData( layer.dataCache[ 1 ], x, y );

  flagLayerTextureChanged( layer );
  if( layer.maskInitialized ) flagLayerMaskChanged( layer );

  //rebuild the datacache
  buildDataCache( layer );
  //have the new data
  const newData = {
    topLeft: [...layer.topLeft],
    topRight: [...layer.topRight],
    bottomLeft: [...layer.bottomLeft],
    bottomRight: [...layer.bottomRight],
    w: layer.w,
    h: layer.h,
    x,
    y,
    canvasData: layer.dataCache[0],
    maskData: layer.dataCache[1], //may be undefined
  }

  //build our undo history entry
  const historyEntry = {
    targetLayer: layer,
    oldData,
    newData,
    applyData: ( dataSource ) => {
      const layer = historyEntry.targetLayer;
      layer.canvas.width = layer.maskCanvas.width = layer.w = dataSource.w;
      layer.canvas.height = layer.maskCanvas.height = layer.h = dataSource.h;     
      layer.topLeft = [...dataSource.topLeft];
      layer.topRight = [...dataSource.topRight];
      layer.bottomLeft = [...dataSource.bottomLeft];
      layer.bottomRight = [...dataSource.bottomRight];
      layer.context.putImageData( dataSource.canvasData, dataSource.x, dataSource.y );
      //The frames update on layer texture update
      flagLayerTextureChanged( layer );
      if( layer.maskInitialized ) {
        layer.maskContext.putImageData( dataSource.maskData, dataSource.x, dataSource.y );
        flagLayerMaskChanged( layer );
      }
    },
    undo: () => { historyEntry.applyData( historyEntry.oldData ) },
    redo: () => { historyEntry.applyData( historyEntry.newData ) },
  }
  recordHistoryEntry( historyEntry );

}

async function deleteLayer( layer ) {

  //if this layer is selected, unselect it
  if( selectedLayer === layer ) {
    selectedLayer = null;
    declareSelectionChanged();
  }
  if( batchedLayers.has( layer ) ) {
    batchedLayers.delete( layer );
    declareSelectionChanged();
  }
  //(we'll reselect a new layer at the bottom of this function)

  //delete layer (and any children) from stack
  const index = layersStack.layers.indexOf( layer );
  const layerIndexPairs = [ [layer, index] ];
  layersStack.layers.splice( index, 1 );
  const groupsToCheck = [];
  if( layer.layerType === "group" ) groupsToCheck.push( layer.layerId );
  while( groupsToCheck.length ) {
    const groupId = groupsToCheck.pop();
    for( let i=layersStack.layers.length-1; i>=0; i-- ) {
      const searchLayer = layersStack.layers[ i ];
      if( searchLayer.layerGroupId === groupId ) {
        layerIndexPairs.push( [searchLayer,i] );
        if( searchLayer.layerType === "group" )
          groupsToCheck.push( searchLayer.layerId );
        layersStack.layers.splice( i, 1 );
      }
    }
  }
  
  //add an undo entry
  const historyEntry = {
    index,
    layerIndexPairs,
    newLayer: layer,
    undo: () => {
      //insert into the layer stack in reverse order
      for( let i=historyEntry.layerIndexPairs.length-1; i>=0; i-- ) {
        const [layer,index] = historyEntry.layerIndexPairs[ i ];
        layersStack.layers.splice( index, 0, layer );
      }
      reorganizeLayerButtons();
      UI.updateContext();
    
    },
    redo: () => {
      //delete from the layer stack in order
      for( const [,index] of historyEntry.layerIndexPairs ) {
        layersStack.layers.splice( index, 1 );
      }
      reorganizeLayerButtons();
      UI.updateContext();
    
    },
    cleanup: () => {
      //layers won't be coming back.
      for( const [layer] of historyEntry.layerIndexPairs ) {
        gl.deleteTexture( layer.glTexture );
        gl.deleteTexture( layer.glMask );
      }
    }
  }
  //:-O And record this horrifyingly subtle algorithm for future testing
  recordHistoryEntry( historyEntry );

  /* //get the next layer
  let nextLayer;
  if( index < layersStack.layers.length ) {
    //search for a non-preview layer
    for( let i=index; i<layersStack.layers.length; i++ ) {
      const searchLayer = layersStack.layers[ i ];
      if( searchLayer.layerType === "_temp" ) continue;
      nextLayer = searchLayer;
      break;
    }
  }
  if( ! nextLayer && index > 0 ) {
    //search for a non-preview layer
    for( let i=index-1; i>=0; i-- ) {
      const searchLayer = layersStack.layers[ i ];
      if( searchLayer.layerType === "_temp" ) continue;
      nextLayer = searchLayer;
      break;
    }
  } */

  reorganizeLayerButtons();

  //if( nextLayer ) selectLayer( nextLayer ); //calls updateContext
  //otherwise, there are truly no layers left except previews
  //else UI.updateContext();

  UI.updateContext();

}

function initializeLayerMask( layer, state ) {
  if( state === "transparent" ) {
    layer.maskContext.clearRect( 0,0,layer.w,layer.h );
  }
  if( state === "opaque" ) {
    layer.maskContext.fillStyle = "rgb(255,255,255)";
    layer.maskContext.fillRect( 0,0,layer.w,layer.h );
  }
  layer.maskInitializedState = state;
  layer.maskChanged = true;
  layer.maskChangedRect.x = 0;
  layer.maskChangedRect.y = 0;
  layer.maskChangedRect.w = layer.w;
  layer.maskChangedRect.h = layer.h;

  layer.layerButton.appendChild( layer.maskCanvas );

  layer.maskInitialized = true;
  layer.maskUnpainted = true;
}

function uninitializeLayerMask( layer ) {
  console.log( "Uninitialized mask." );
  layer.layerButton.removeChild( layer.maskCanvas );

  //opacify the mask
  layer.maskContext.fillStyle = "rgb(255,255,255)";
  layer.maskContext.fillRect( 0,0,layer.w,layer.h );
  layer.maskInitialized = false;
  layer.maskUnpainted = true;
}

function removeLayerFromSelection( layer ) {
  if( layer.layerType === "group" ) {
    collectGroupedLayersAsFlatList( layer.layerId ).forEach( l => batchedLayers.delete( l ) );
  }
  batchedLayers.delete( layer );
  document.querySelectorAll( ".layer-button" ).forEach( l => l.classList.remove( "active", "selected", "hovering", "no-hover" ) );
  for( const l of batchedLayers ) l.layerButton.classList.add( "selected" );
  declareSelectionChanged();
}
function addLayerToSelection( layer ) {
  if( selectedLayer ) {
    selectedLayer.layerButton.querySelector( ".layer-name" ).uiActive = false;
    //not visually hidden, just non-hoverable in UI
    selectedLayer.layerButton.querySelector( ".layer-name" ).classList.add( "no-hover" );
    batchedLayers.add( selectedLayer );
    selectedLayer = null;
  }
  batchedLayers.add( layer );
  if( layer.layerType === "group" ) {
    collectGroupedLayersAsFlatList( layer.layerId ).forEach( l => batchedLayers.add( l ) );
  }
  document.querySelectorAll( ".layer-button" ).forEach( l => l.classList.remove( "active", "selected", "hovering", "no-hover" ) );
  for( const l of batchedLayers ) l.layerButton.classList.add( "selected" );
  declareSelectionChanged();
}

function selectLayer( layer ) {
  if( selectedLayer ) {
    selectedLayer.layerButton.querySelector( ".layer-name" ).uiActive = false;
    //not visually hidden, just non-hoverable in UI
    selectedLayer.layerButton.querySelector( ".layer-name" ).classList.add( "no-hover" );
  }
  if( batchedLayers.size ) {
    batchedLayers.clear();
  }
  selectedLayer = layer;
  if( layer ) {
    if( layer.layerType === "group" ) {
      updateLayerGroupCoordinates( layer );
    }
    for( const l of document.querySelectorAll( "#layers-column > .layer-button" ) ) {
      l.classList.remove( "active", "selected", "no-hover", "hovering" );
    }
    layer.layerButton.classList.add( "active", "no-hover" );
    layer.layerButton.classList.remove( "hovering" );
    layer.layerButton.querySelector( ".layer-name" ).uiActive = true;
    layer.layerButton.querySelector( ".layer-name" ).classList.remove( "no-hover" );  
  }
  declareSelectionChanged();
  UI.updateContext();
}


let looping = true,
 T = -1,
 fps = 0;
function Loop( t ) {
    if( T === -1 ) T = t - 1;
    const dt = t - T;
    T = t;

    const floatTime = ( t % 50000 ) / 50000;

    const secondsPerFrame = dt / 1000;
    const framesPerSecond = 1 / secondsPerFrame;
    fps = ( fps * 0.95 ) + framesPerSecond * 0.05;

    if( uiSettings.showDebugInfo === true )
    document.querySelector("#console" ).textContent = 
      `${parseInt(fps).toString()} FPS`;

    if( looping ) window.requestAnimationFrame( Loop );
    else return requestAnimationFrame( Loop );

    updateCycle( t );

    
    //writeInfo();

    
    if( glState.ready ) {

      //for each layer:
      // get its transformed points.
      // upload those transformed points to the vertex buffer
      // activate the layer's texture
      // if the layer has changed, reupload its canvas
      // draw the layer with a draw call (don't optimize, iterate)
      
      //TODO: Here we need to collect all transforming layers, if any
      const visibleLayers = [],
        selectedGroupLayers = [];

      for( const layer of layersStack.layers ) {
        if( layer.layerType === "_temp" )
          continue;
        if( layer.layerType === "group" ) {
          if(  layer !== selectedLayer ) {
            continue;
          }
          else if( layer === selectedLayer ) {
            //grab layers within selected layer group to show their borders.
            selectedGroupLayers.push( ...collectGroupedLayersAsFlatList( layer.layerId ) );
          }
        }
        if( getLayerVisibility( layer ) ) {
          visibleLayers.push( layer );
        }
      }
      for( const batchedLayer of batchedLayers ) {
        if( selectedGroupLayers.indexOf( batchedLayer ) > -1 ) continue;
        if( batchedLayer.layerType === "group" ) continue;
        selectedGroupLayers.push( batchedLayer );
      }


      if( lassoResources.ready ) {
        const preview = updateLassoPreview();
        if( preview ) visibleLayers.push( preview );
      }

      getTransform();

      const screenPointRect = getScreenPointRect();

      //renderLayers( visibleLayers, selectedGroupLayers, floatTime, null, [ 0.25,0.25,0.25, 1 ], true );
      //renderLayersIntoPointRect( screenPointRect, visibleLayers, selectedGroupLayers, floatTime, null, [ 0.25,0.25,0.25, 1 ], true );
      renderLayersIntoPointRect( screenPointRect, visibleLayers, selectedGroupLayers, floatTime, null, [ 0,0,0,0 ], true );
      //simpleRenderLayersIntoPointRect( screenPointRect, visibleLayers, null, true ); //this was just to test simplerender

      //get the eyedropper color
      if( airInput.active ) {
        gl.bindFramebuffer( gl.READ_FRAMEBUFFER, null );
        airInput.updateEyedropper();
      }

    }

}

function getScreenPointRect() {

  if( ! getScreenPointRect.pointRect ) {
    getScreenPointRect.pointRect = {
      topLeft: [0,0,1],
      topRight: [0,0,1],
      bottomLeft: [0,0,1],
      bottomRight: [0,0,1],
      w: 0,
      h: 0
    }
  }

  //get our inversion
  _originMatrix[ 2 ] = -view.origin.x;
  _originMatrix[ 5 ] = -view.origin.y;
  _positionMatrix[ 2 ] = view.origin.x;
  _positionMatrix[ 5 ] = view.origin.y;

  mul3x3( viewMatrices.current , _originMatrix , _inverter );
  mul3x3( _inverter , viewMatrices.moving , _inverter );
  mul3x3( _inverter , _positionMatrix , _inverter );
  inv( _inverter , _inverter );

  const pointRect = getScreenPointRect.pointRect;
  const w = gnv.width, h = gnv.height;

  mul3x1( _inverter, [0,0,1], pointRect.topLeft );
  mul3x1( _inverter, [w,0,1], pointRect.topRight );
  mul3x1( _inverter, [0,h,1], pointRect.bottomLeft );
  mul3x1( _inverter, [w,h,1], pointRect.bottomRight );
  pointRect.w = w;
  pointRect.h = h;

  return pointRect;

}

function renderLayersIntoPointRect( pointRect, visibleLayers, layersWithVisibleBorders, floatTime, targetLayer = null, backgroundRGBA = [0,0,0,0], showBorders = true, flipY = true ) {

  //we need basically the code from samplelayerinlayer
  //for every layer, we need to cast it to pointRect's space
  //from there, we can calculate rotation and scale, but in this case that casting is all we need.
  
  //Note that the scale of our pointRect is independent of the canvas dims of our targetLayer (or screen)

  //get our rectLayer's coordinate space
  const origin = { x:pointRect.topLeft[0], y:pointRect.topLeft[1] },
    xLeg = { x:pointRect.topRight[0] - origin.x, y: pointRect.topRight[1] - origin.y },
    xLegLengthInverse = 1 / Math.sqrt( xLeg.x**2 + xLeg.y**2 ),
    normalizedXLeg = { x:xLeg.x * xLegLengthInverse, y:xLeg.y * xLegLengthInverse },
    yLeg = { x:pointRect.bottomLeft[0] - origin.x, y: pointRect.bottomLeft[1] - origin.y },
    yLegLengthInverse = 1 / Math.sqrt( yLeg.x**2 + yLeg.y**2 ),
    normalizedYLeg = { x:yLeg.x * yLegLengthInverse, y:yLeg.y * yLegLengthInverse };
  //console.log( origin.x, origin.y, xLeg.x, xLeg.y, xLegLengthInverse, normalizedXLeg.x, normalizedXLeg.y, yLeg.x, yLeg.y, yLegLengthInverse, normalizedYLeg.x, normalizedYLeg.y );

  if( ! renderLayersIntoPointRect.framebuffer ) {
    renderLayersIntoPointRect.readPixelsDest = new Uint8ClampedArray( 4 );
    renderLayersIntoPointRect.midFramebuffer = gl.createFramebuffer();
    renderLayersIntoPointRect.framebuffer = gl.createFramebuffer();
    if( targetLayer === null ) {
      renderLayersIntoPointRect.width = gnv.width;
      renderLayersIntoPointRect.height = gnv.height;
    } else {
      renderLayersIntoPointRect.width = targetLayer.canvas.width;
      renderLayersIntoPointRect.height = targetLayer.canvas.height;
    }

    {
      renderLayersIntoPointRect.blankTexture = gl.createTexture();
      gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.blankTexture );
      const blankData = new Uint8ClampedArray( 4 * 4 );
      blankData.fill( 255 );
      gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, blankData );
      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    {
      renderLayersIntoPointRect.colorTexture = gl.createTexture();
      gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.colorTexture );
      const blankData = new Uint8ClampedArray( 4 * 4 );
      blankData.fill( 255 );
      gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, blankData );
      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    {
      renderLayersIntoPointRect.backTexture = gl.createTexture();
      gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.backTexture );
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, renderLayersIntoPointRect.width, renderLayersIntoPointRect.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
     
      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // attach the texture as the first color attachment
      //const attachmentPoint = gl.COLOR_ATTACHMENT0;
      //gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, renderLayers.backTexture, level);
  
    }

    //renderLayers.depthTexture = gl.createTexture();
    
    {
      renderLayersIntoPointRect.midTexture = gl.createTexture();
      gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.midTexture );
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, renderLayersIntoPointRect.width, renderLayersIntoPointRect.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
     
      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

  }

  gl.useProgram( glState.program );

  //resize the back texture
  let targetWidth = gnv.width,
    targetHeight = gnv.height;
  if( targetLayer !== null ) {
    targetWidth = targetLayer.canvas.width;
    targetHeight = targetLayer.canvas.height;
  }
  if( renderLayersIntoPointRect.width !== targetWidth || renderLayersIntoPointRect.height !== targetHeight ) {
    renderLayersIntoPointRect.width = targetWidth;
    renderLayersIntoPointRect.height = targetHeight;
    gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.backTexture );
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, renderLayersIntoPointRect.width, renderLayersIntoPointRect.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.midTexture );
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, renderLayersIntoPointRect.width, renderLayersIntoPointRect.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  
  //No depth bound! :-O
  //gl.bindTexture( gl.TEXTURE_2D, renderLayers.depthTexture );
  //gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, renderLayers.depthTexture, level);

  //clear both buffers
  {
    gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.backTexture );
    // attach the back texture as the first color attachment
    gl.bindFramebuffer( gl.FRAMEBUFFER, renderLayersIntoPointRect.framebuffer );
    const attachmentPoint = gl.COLOR_ATTACHMENT0, level = 0;
    gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, renderLayersIntoPointRect.backTexture, level);
    gl.viewport( 0, 0, targetWidth, targetHeight );
    gl.clearColor( ...backgroundRGBA );
    gl.clear( gl.COLOR_BUFFER_BIT );
  }
  {
    gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.midTexture );
    // attach the back texture as the first color attachment
    gl.bindFramebuffer( gl.FRAMEBUFFER, renderLayersIntoPointRect.midFramebuffer );
    const attachmentPoint = gl.COLOR_ATTACHMENT0, level = 0;
    gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, renderLayersIntoPointRect.midTexture, level);
    gl.viewport( 0, 0, targetWidth, targetHeight );
    gl.clearColor( ...backgroundRGBA );
    gl.clear( gl.COLOR_BUFFER_BIT );
  }
  
  gl.disable( gl.DEPTH_TEST );
  gl.disable( gl.BLEND );

  gl.bindVertexArray(glState.vao);

  let drewToMidTexture = false;
  for( const layer of visibleLayers ) {

    drewToMidTexture = !drewToMidTexture;

    if( drewToMidTexture === false ) {
      const attachmentPoint = gl.COLOR_ATTACHMENT0, level = 0;
      // attach the back texture as the first color attachment
      gl.bindFramebuffer( gl.FRAMEBUFFER, renderLayersIntoPointRect.framebuffer );
      gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.backTexture );
      gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, renderLayersIntoPointRect.backTexture, level);
      gl.viewport( 0, 0, targetWidth, targetHeight );
    }
    if( drewToMidTexture === true ) {
      const attachmentPoint = gl.COLOR_ATTACHMENT0, level = 0;
      // attach the back texture as the first color attachment
      gl.bindFramebuffer( gl.FRAMEBUFFER, renderLayersIntoPointRect.midFramebuffer );
      gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.midTexture );
      gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, renderLayersIntoPointRect.midTexture, level);
      gl.viewport( 0, 0, targetWidth, targetHeight );
    }


    const castPoints = {};
    for( const pointName of [ "topLeft", "topRight", "bottomLeft", "bottomRight" ] ) {
      let [x,y] = layer[ pointName ];
      //translate from origin
      x -= origin.x; y -= origin.y;
      //project on normals
      let xProjection = x*normalizedXLeg.x + y*normalizedXLeg.y;
      let yProjection = x*normalizedYLeg.x + y*normalizedYLeg.y;
      //unnormalize
      xProjection *= targetWidth * xLegLengthInverse;
      yProjection *= targetHeight * yLegLengthInverse;
      castPoints[ pointName ] = [ xProjection, yProjection, 1 ];
    }

    let xy = castPoints.topLeft,
      xy2 = castPoints.topRight,
      xy3 = castPoints.bottomLeft,
      xy4 = castPoints.bottomRight;

    if( uiSettings.activeTool === "transform" && uiSettings.toolsSettings.transform.current === true && uiSettings.toolsSettings.transform.transformingLayers.includes( layer ) && ( cursor.mode !== "none" || pointers.count === 2 ) ) {
      getLayerTransform();
      let [x,y] = transformLayerPoint( xy ),
        [x2,y2] = transformLayerPoint( xy2 ),
        [x3,y3] = transformLayerPoint( xy3 ),
        [x4,y4] = transformLayerPoint( xy4 );
      xy = [x,y,1]; xy2 = [x2,y2,1]; xy3 = [x3,y3,1]; xy4 = [x4,y4,1];
      layer.transform.transformingPoints.topLeft = [...xy];
      layer.transform.transformingPoints.topRight = [...xy2];
      layer.transform.transformingPoints.bottomLeft = [...xy3];
      layer.transform.transformingPoints.bottomRight = [...xy4];
    } 

    //get the layer's physical size on-display
    //(Not used until later, but must calculate before gl-transforming points)
    let layerSizePixels;
    {
      const dx = xy2[0] - xy[0], dy = xy2[1] - xy[1];
      layerSizePixels = Math.sqrt( dx**2 + dy**2 );
    }

    //convert that screenspace to GL space
    const glOriginX = targetWidth/2, glOriginY = targetHeight/2;
    for( const p of [xy,xy2,xy3,xy4] ) {
      p[0] -= glOriginX; p[1] -= glOriginY;
      p[0] /= glOriginX;
      //We're flipping the y coordinate! OpenGL NDC space defines the bottom of the screen as -1 y, and the top as +1 y (center 0).
      if( flipY === true ) p[1] /= -glOriginY;
      else p[1] /= glOriginY;
    }

    //update the vertex data
    //top-left triangle
    glState.vertices[0] = xy[0]; glState.vertices[1] = xy[1];
    glState.vertices[4] = xy2[0]; glState.vertices[5] = xy2[1];
    glState.vertices[8] = xy3[0]; glState.vertices[9] = xy3[1];
    //bottom-right triangle
    glState.vertices[12] = xy2[0]; glState.vertices[13] = xy2[1];
    glState.vertices[16] = xy4[0]; glState.vertices[17] = xy4[1];
    glState.vertices[20] = xy3[0]; glState.vertices[21] = xy3[1];
    //push the updated vertex data to the GPU
    gl.bindBuffer( gl.ARRAY_BUFFER, glState.vertexBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, glState.vertices, gl.STREAM_DRAW );

    //do I need to re-enable the vertex array??? Let's assume so, then try coding this out later
    gl.enableVertexAttribArray( glState.xyuvInputIndex );
    {
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( glState.xyuvInputIndex, size, dType, normalize, stride, offset );
    }

    //let's bind the layer's texture
    gl.activeTexture( gl.TEXTURE0 + 0 );
    gl.bindTexture( gl.TEXTURE_2D, layer.glTexture );
    if( layer.layerType !== "group" && layer.textureChanged ) {
      //let's re-upload the layer's texture when it's changed
      const mipLevel = 0,
      internalFormat = gl.RGBA,
      //internalFormat = gl.RGBA16F,
      srcFormat = gl.RGBA,
      srcType = gl.UNSIGNED_BYTE;
      gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, layer.canvas );
      layer.textureChanged = false;
    }
    //point the layer's source image at texture 0
    gl.uniform1i( gl.getUniformLocation( glState.program, "img" ), 0 );

    //bind the layer's mask
    gl.activeTexture( gl.TEXTURE0 + 1 );
    gl.bindTexture( gl.TEXTURE_2D, layer.glMask );
    if( layer.layerType !== "group" && layer.maskChanged ) {
      //re-upload the layer's mask when it's changed
      const mipLevel = 0,
      internalFormat = gl.RGBA,
      //internalFormat = gl.RGBA16F,
      srcFormat = gl.RGBA,
      srcType = gl.UNSIGNED_BYTE;
      gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, layer.maskCanvas );
      layer.maskChanged = false;
    }
    //point the mask at texture 1
    gl.uniform1i( gl.getUniformLocation( glState.program, "imgMask" ), 1 );

    //bind the previous render result as the canvas
    gl.activeTexture( gl.TEXTURE0 + 2 );
    if( drewToMidTexture === false ) { gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.midTexture ); }
    if( drewToMidTexture === true ) { gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.backTexture ); }
    //point canvas at texture 2
    gl.uniform1i( gl.getUniformLocation( glState.program, "canvas" ), 2 );


    //set the layer's alpha
    gl.uniform1f( glState.alphaInputIndex, getLayerOpacity( layer ) );
    let maskVisibility = 0.0;
    if( layer === selectedLayer && uiSettings.activeTool === "mask" && layer.maskInitialized )
      maskVisibility = 0.5;
    gl.uniform1f( glState.alphaMaskIndex, maskVisibility );
    gl.uniform1f( glState.timeIndex, floatTime );
    const blendMode = glState.layerBlendModes.indexOf( layer.blendMode || "normal" );
    //console.log( "Setting blend mode ", blendMode, " for layer id ", layer.layerId );
    gl.uniform1i( glState.blendModeIndex, blendMode );

    let borderIsVisible = layer === selectedLayer;

    //disable border while transform group to avoid recalculating coordinates every cycle (and visuals are confusing anyway)
    if( layer.layerType === "group" && uiSettings.activeTool === "transform" && uiSettings.toolsSettings.transform.current === true && ( cursor.mode !== "none" || pointers.count === 2 ) )
      borderIsVisible = false;

    if( borderIsVisible === false && layersWithVisibleBorders.includes( layer ) )
      borderIsVisible = true;

    if( showBorders === false )
      borderIsVisible = false;

    gl.uniform1f( glState.borderVisibilityIndex, borderIsVisible ? 0.33 : 0.0 );
    gl.uniform1f( glState.borderWidthIndex, 2.0 / layerSizePixels ); //2 pixel border width

    {
      //and draw our triangles
      const primitiveType = gl.TRIANGLES,
        structStartOffset = 0,
        structCount = 6;
      gl.drawArrays( primitiveType, structStartOffset, structCount );
    }
    
    //blit from the current framebuffer to whichever texture we're not using
    if( drewToMidTexture === false ) {
      gl.bindFramebuffer( gl.READ_FRAMEBUFFER, renderLayersIntoPointRect.framebuffer );
      gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, renderLayersIntoPointRect.midFramebuffer );
      gl.blitFramebuffer( 0,0,targetWidth,targetHeight, 0,0,targetWidth,targetHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST );
    }
    if( drewToMidTexture === true ) {
      gl.bindFramebuffer( gl.READ_FRAMEBUFFER, renderLayersIntoPointRect.midFramebuffer );
      gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, renderLayersIntoPointRect.framebuffer );
      gl.blitFramebuffer( 0,0,targetWidth,targetHeight, 0,0,targetWidth,targetHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST );
    }

  }


  //draw the backtexture to the screen as if it was a layer
  {
    if( targetLayer === null ) {
      //render to the screen canvas
      gl.bindFramebuffer( gl.FRAMEBUFFER, null );
    }
    else {
      const attachmentPoint = gl.COLOR_ATTACHMENT0, level = 0;
      gl.bindFramebuffer( gl.FRAMEBUFFER, renderLayersIntoPointRect.framebuffer );
      gl.bindTexture( gl.TEXTURE_2D, targetLayer.glTexture );
      //resize (and clear) the target layer's texture
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, targetWidth, targetHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      // render to the target layer's texture
      gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, targetLayer.glTexture, level);
      gl.viewport( 0, 0, targetWidth, targetHeight );
    }
    gl.viewport( 0, 0, targetWidth, targetHeight );
    gl.clearColor( ...backgroundRGBA ); //never seen tho
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
    gl.disable( gl.DEPTH_TEST );
    gl.disable( gl.BLEND );
  
    //update the vertex data
    //top-left triangle
    glState.vertices[0] = -1; glState.vertices[1] = -1;
    glState.vertices[4] = 1; glState.vertices[5] = -1;
    glState.vertices[8] = -1; glState.vertices[9] = 1;
    //bottom-right triangle
    glState.vertices[12] = 1; glState.vertices[13] = -1;
    glState.vertices[16] = 1; glState.vertices[17] = 1;
    glState.vertices[20] = -1; glState.vertices[21] = 1;
    //push the updated vertex data to the GPU
    gl.bindBuffer( gl.ARRAY_BUFFER, glState.vertexBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, glState.vertices, gl.STREAM_DRAW );

    gl.enableVertexAttribArray( glState.xyuvInputIndex );
    {
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( glState.xyuvInputIndex, size, dType, normalize, stride, offset );
    }

    //bind the backtexture as the layer's source
    gl.activeTexture( gl.TEXTURE0 + 0 );
    if( drewToMidTexture === false ) gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.backTexture );
    if( drewToMidTexture === true ) gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.midTexture );
    //point the layer's source image at texture 0
    gl.uniform1i( gl.getUniformLocation( glState.program, "img" ), 0 );

    //blank the mask (solid alpha)
    gl.activeTexture( gl.TEXTURE0 + 1 );
    gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.blankTexture );
    gl.uniform1i( gl.getUniformLocation( glState.program, "imgMask" ), 1 );

    //blank or color the undercanvas (this is the base-mix color)
    {
      gl.activeTexture( gl.TEXTURE0 + 2 );
      gl.bindTexture( gl.TEXTURE_2D, renderLayersIntoPointRect.colorTexture );
      const colorData = new Uint8ClampedArray( [ ...backgroundRGBA, ...backgroundRGBA, ...backgroundRGBA, ...backgroundRGBA ] );
      gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, colorData );
      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i( gl.getUniformLocation( glState.program, "canvas" ), 2 );
    }

    //set the layer's alpha
    gl.uniform1f( glState.alphaInputIndex, 1.0 );
    gl.uniform1f( glState.alphaMaskIndex, 0.0 );
    gl.uniform1f( glState.timeIndex, 0.0 );
    gl.uniform1f( glState.borderVisibilityIndex, 0.0 );
    gl.uniform1f( glState.borderWidthIndex, 2.0 / targetWidth ); //2 pixel border width (avoid div by zero can change IDK)
    gl.uniform1i( glState.blendModeIndex, glState.layerBlendModes.indexOf( "normal" ) ); //set normal blend mode

    {
      //and draw our screen-triangle
      const primitiveType = gl.TRIANGLES, structStartOffset = 0, structCount = 6;
      gl.drawArrays( primitiveType, structStartOffset, structCount );
    }

  }

  //bring the pixel data back to the CPU if necessary
  if( targetLayer !== null ) {
    const newData = targetLayer.context.createImageData( targetWidth, targetHeight );
    gl.readPixels( 0, 0, targetWidth, targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, newData.data );
    targetLayer.context.putImageData( newData, 0, 0 );
  }

}

function renderLayersAlphasIntoPointRect( pointRect, visibleLayers, targetLayer = null, flipY = true, color=[255,255,255], readPixelsArray = null ) {

  //we need basically the code from samplelayerinlayer
  //for every layer, we need to cast it to pointRect's space
  //from there, we can calculate rotation and scale, but in this case that casting is all we need.
  
  //Note that the scale of our pointRect is independent of the canvas dims of our targetLayer (or screen)

  if( ! renderLayersAlphasIntoPointRect.framebuffer ) {
    renderLayersAlphasIntoPointRect.framebuffer = gl.createFramebuffer();
  }

  //get our rectLayer's coordinate space
  const origin = { x:pointRect.topLeft[0], y:pointRect.topLeft[1] },
    xLeg = { x:pointRect.topRight[0] - origin.x, y: pointRect.topRight[1] - origin.y },
    xLegLengthInverse = 1 / Math.sqrt( xLeg.x**2 + xLeg.y**2 ),
    normalizedXLeg = { x:xLeg.x * xLegLengthInverse, y:xLeg.y * xLegLengthInverse },
    yLeg = { x:pointRect.bottomLeft[0] - origin.x, y: pointRect.bottomLeft[1] - origin.y },
    yLegLengthInverse = 1 / Math.sqrt( yLeg.x**2 + yLeg.y**2 ),
    normalizedYLeg = { x:yLeg.x * yLegLengthInverse, y:yLeg.y * yLegLengthInverse };
    
  gl.useProgram( glStateAlphaRender.program );

  //resize the destination texture
  let targetWidth = gnv.width,
    targetHeight = gnv.height;
  if( targetLayer !== null ) {
    targetWidth = targetLayer.canvas.width;
    targetHeight = targetLayer.canvas.height;
  }

  if( targetLayer === null ) {
    gl.bindFramebuffer( gl.FRAMEBUFFER, null );
  } else {
    gl.bindTexture( gl.TEXTURE_2D, targetLayer.glTexture );
    gl.bindFramebuffer( gl.FRAMEBUFFER, renderLayersAlphasIntoPointRect.framebuffer );
    const attachmentPoint = gl.COLOR_ATTACHMENT0, level = 0;
    gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, targetLayer.glTexture, level);
  }

  //set drawing behavior and clear
  gl.disable(gl.DEPTH_TEST);
  gl.enable( gl.BLEND );
  gl.blendFunc( gl.ONE, gl.ONE );

  gl.viewport( 0, 0, targetWidth, targetHeight );
  gl.clearColor(0,0,0,0);
  gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

  gl.bindVertexArray(glStateAlphaRender.vao);

  for( const layer of visibleLayers ) {

    const castPoints = {};
    for( const pointName of [ "topLeft", "topRight", "bottomLeft", "bottomRight" ] ) {
      let [x,y] = layer[ pointName ];
      //translate from origin
      x -= origin.x; y -= origin.y;
      //project on normals
      let xProjection = x*normalizedXLeg.x + y*normalizedXLeg.y;
      let yProjection = x*normalizedYLeg.x + y*normalizedYLeg.y;
      //unnormalize
      xProjection *= targetWidth * xLegLengthInverse;
      yProjection *= targetHeight * yLegLengthInverse;
      castPoints[ pointName ] = [ xProjection, yProjection, 1 ];
    }

    let xy = castPoints.topLeft,
      xy2 = castPoints.topRight,
      xy3 = castPoints.bottomLeft,
      xy4 = castPoints.bottomRight;

    //we're ignoring active layer transforms! that's not what this render function is for

    //get the layer's pixel size on the destination
    //(Not used until later, but must calculate before gl-transforming points)
    let layerSizePixels;
    {
      const dx = xy2[0] - xy[0], dy = xy2[1] - xy[1];
      layerSizePixels = Math.sqrt( dx**2 + dy**2 );
    }

    //convert that screenspace to GL space
    const glOriginX = targetWidth/2, glOriginY = targetHeight/2;
    for( const p of [xy,xy2,xy3,xy4] ) {
      p[0] -= glOriginX; p[1] -= glOriginY;
      p[0] /= glOriginX;
      //We're flipping the y coordinate! OpenGL NDC space defines the bottom of the screen as -1 y, and the top as +1 y (center 0).
      if( flipY === true ) p[1] /= -glOriginY;
      else p[1] /= glOriginY;
    }

    //update the vertex data
    //top-left triangle
    glStateAlphaRender.vertices[0] = xy[0]; glStateAlphaRender.vertices[1] = xy[1];
    glStateAlphaRender.vertices[4] = xy2[0]; glStateAlphaRender.vertices[5] = xy2[1];
    glStateAlphaRender.vertices[8] = xy3[0]; glStateAlphaRender.vertices[9] = xy3[1];
    //bottom-right triangle
    glStateAlphaRender.vertices[12] = xy2[0]; glStateAlphaRender.vertices[13] = xy2[1];
    glStateAlphaRender.vertices[16] = xy4[0]; glStateAlphaRender.vertices[17] = xy4[1];
    glStateAlphaRender.vertices[20] = xy3[0]; glStateAlphaRender.vertices[21] = xy3[1];
    //push the updated vertex data to the GPU
    gl.bindBuffer( gl.ARRAY_BUFFER, glStateAlphaRender.vertexBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, glStateAlphaRender.vertices, gl.STREAM_DRAW );

    //do I need to re-enable the vertex array??? Let's assume so, then try coding this out later
    gl.enableVertexAttribArray( glStateAlphaRender.xyuvInputIndex );
    {
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( glStateAlphaRender.xyuvInputIndex, size, dType, normalize, stride, offset );
    }

    //let's bind the layer's texture
    gl.activeTexture( gl.TEXTURE0 + 0 );
    gl.bindTexture( gl.TEXTURE_2D, layer.glTexture );
    //we're not reuploading the layer's texture on flag change!
    //point the layer's source image at texture 0
    gl.uniform1i( gl.getUniformLocation( glStateAlphaRender.program, "img" ), 0 );

    gl.uniform3fv( gl.getUniformLocation( glStateAlphaRender.program, "color" ), color )

    //ignoring layer mask, this isn't for that

    {
      //and draw our triangles
      const primitiveType = gl.TRIANGLES,
        structStartOffset = 0,
        structCount = 6;
      gl.drawArrays( primitiveType, structStartOffset, structCount );
    }

  }

  //and that's it for our drawing

  //bring the pixel data back to the CPU if called for
  if( readPixelsArray ) {
    gl.readPixels( 0, 0, targetWidth, targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, readPixelsArray );
  }

}

function renderLassoPreviewIntoPointRect( pointRect, lassoLayers, floatTime, targetLayer = null, flipY = true, invert = false ) {

  //we need basically the code from samplelayerinlayer
  //for every layer, we need to cast it to pointRect's space
  //from there, we can calculate rotation and scale, but in this case that casting is all we need.
  
  //Note that the scale of our pointRect is independent of the canvas dims of our targetLayer (or screen)

  if( ! renderLayersAlphasIntoPointRect.framebuffer ) {
    renderLayersAlphasIntoPointRect.framebuffer = gl.createFramebuffer();
  }

  //get our rectLayer's coordinate space
  const origin = { x:pointRect.topLeft[0], y:pointRect.topLeft[1] },
    xLeg = { x:pointRect.topRight[0] - origin.x, y: pointRect.topRight[1] - origin.y },
    xLegLengthInverse = 1 / Math.sqrt( xLeg.x**2 + xLeg.y**2 ),
    normalizedXLeg = { x:xLeg.x * xLegLengthInverse, y:xLeg.y * xLegLengthInverse },
    yLeg = { x:pointRect.bottomLeft[0] - origin.x, y: pointRect.bottomLeft[1] - origin.y },
    yLegLengthInverse = 1 / Math.sqrt( yLeg.x**2 + yLeg.y**2 ),
    normalizedYLeg = { x:yLeg.x * yLegLengthInverse, y:yLeg.y * yLegLengthInverse };
    
  gl.useProgram( glStateLassoPreview.program );
  
  //resize the destination texture
  let targetWidth = gnv.width,
    targetHeight = gnv.height;
  if( targetLayer !== null ) {
    targetWidth = targetLayer.canvas.width;
    targetHeight = targetLayer.canvas.height;
  }

  if( targetLayer === null ) {
    gl.bindFramebuffer( gl.FRAMEBUFFER, null );
  } else {
    gl.bindTexture( gl.TEXTURE_2D, targetLayer.glTexture );
    gl.bindFramebuffer( gl.FRAMEBUFFER, renderLayersAlphasIntoPointRect.framebuffer );
    const attachmentPoint = gl.COLOR_ATTACHMENT0, level = 0;
    gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, targetLayer.glTexture, level);
  }

  //set drawing behavior and clear
  gl.disable(gl.DEPTH_TEST);
  gl.enable( gl.BLEND );
  gl.blendFunc( gl.ONE, gl.ONE );

  gl.viewport( 0, 0, targetWidth, targetHeight );
  gl.clearColor(0,0,0,0);
  gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

  gl.bindVertexArray(glStateLassoPreview.vao);

  for( const layer of lassoLayers ) {

    const castPoints = {};
    for( const pointName of [ "topLeft", "topRight", "bottomLeft", "bottomRight" ] ) {
      let [x,y] = layer[ pointName ];
      //translate from origin
      x -= origin.x; y -= origin.y;
      //project on normals
      let xProjection = x*normalizedXLeg.x + y*normalizedXLeg.y;
      let yProjection = x*normalizedYLeg.x + y*normalizedYLeg.y;
      //unnormalize
      xProjection *= targetWidth * xLegLengthInverse;
      yProjection *= targetHeight * yLegLengthInverse;
      castPoints[ pointName ] = [ xProjection, yProjection, 1 ];
    }

    let xy = castPoints.topLeft,
      xy2 = castPoints.topRight,
      xy3 = castPoints.bottomLeft,
      xy4 = castPoints.bottomRight;

    //we're ignoring active layer transforms! that's not what this render function is for

    //get the layer's pixel size on the destination
    //(Not used until later, but must calculate before gl-transforming points)
    let layerSizePixels;
    {
      const dx = xy2[0] - xy[0], dy = xy2[1] - xy[1];
      layerSizePixels = Math.sqrt( dx**2 + dy**2 );
    }

    //convert that screenspace to GL space
    const glOriginX = targetWidth/2, glOriginY = targetHeight/2;
    for( const p of [xy,xy2,xy3,xy4] ) {
      p[0] -= glOriginX; p[1] -= glOriginY;
      p[0] /= glOriginX;
      //We're flipping the y coordinate! OpenGL NDC space defines the bottom of the screen as -1 y, and the top as +1 y (center 0).
      if( flipY === true ) p[1] /= -glOriginY;
      else p[1] /= glOriginY;
    }

    //update the vertex data
    //top-left triangle
    glStateLassoPreview.vertices[0] = xy[0]; glStateLassoPreview.vertices[1] = xy[1];
    glStateLassoPreview.vertices[4] = xy2[0]; glStateLassoPreview.vertices[5] = xy2[1];
    glStateLassoPreview.vertices[8] = xy3[0]; glStateLassoPreview.vertices[9] = xy3[1];
    //bottom-right triangle
    glStateLassoPreview.vertices[12] = xy2[0]; glStateLassoPreview.vertices[13] = xy2[1];
    glStateLassoPreview.vertices[16] = xy4[0]; glStateLassoPreview.vertices[17] = xy4[1];
    glStateLassoPreview.vertices[20] = xy3[0]; glStateLassoPreview.vertices[21] = xy3[1];
    //push the updated vertex data to the GPU
    gl.bindBuffer( gl.ARRAY_BUFFER, glStateLassoPreview.vertexBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, glStateLassoPreview.vertices, gl.STREAM_DRAW );

    //do I need to re-enable the vertex array??? Let's assume so, then try coding this out later
    gl.enableVertexAttribArray( glStateLassoPreview.xyuvInputIndex );
    {
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( glStateLassoPreview.xyuvInputIndex, size, dType, normalize, stride, offset );
    }

    //let's bind the layer's texture
    gl.activeTexture( gl.TEXTURE0 + 0 );
    gl.bindTexture( gl.TEXTURE_2D, layer.glTexture );
    //we're not reuploading the layer's texture on flag change!
    //point the layer's source image at texture 0
    gl.uniform1i( gl.getUniformLocation( glStateLassoPreview.program, "img" ), 0 );
    gl.uniform1f( gl.getUniformLocation( glStateLassoPreview.program, "invert" ), invert ? 0 : 1 );
    gl.uniform1f( gl.getUniformLocation( glStateLassoPreview.program, "time" ), floatTime );

    //ignoring layer mask, this isn't for that

    {
      //and draw our triangles
      const primitiveType = gl.TRIANGLES,
        structStartOffset = 0,
        structCount = 6;
      gl.drawArrays( primitiveType, structStartOffset, structCount );
    }

  }

  //and that's it for our drawing

}

function renderLayers( visibleLayers, layersWithVisibleBorders, floatTime, targetLayer = null, backgroundRGBA = [0,0,0,0], showBorders = true, flipY = true ) {

  if( ! renderLayers.framebuffer ) {
    renderLayers.readPixelsDest = new Uint8ClampedArray( 4 );
    renderLayers.midFramebuffer = gl.createFramebuffer();
    renderLayers.framebuffer = gl.createFramebuffer();
    if( targetLayer === null ) {
      renderLayers.width = gnv.width;
      renderLayers.height = gnv.height;
    } else {
      renderLayers.width = targetLayer.w;
      renderLayers.height = targetLayer.h;
    }

    {
      renderLayers.blankTexture = gl.createTexture();
      gl.bindTexture( gl.TEXTURE_2D, renderLayers.blankTexture );
      const blankData = new Uint8ClampedArray( 4 * 4 );
      blankData.fill( 255 );
      gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, blankData );
      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    {
      renderLayers.colorTexture = gl.createTexture();
      gl.bindTexture( gl.TEXTURE_2D, renderLayers.colorTexture );
      const blankData = new Uint8ClampedArray( 4 * 4 );
      blankData.fill( 255 );
      gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, blankData );
      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    {
      renderLayers.backTexture = gl.createTexture();
      gl.bindTexture( gl.TEXTURE_2D, renderLayers.backTexture );
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, renderLayers.width, renderLayers.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
     
      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // attach the texture as the first color attachment
      //const attachmentPoint = gl.COLOR_ATTACHMENT0;
      //gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, renderLayers.backTexture, level);
  
    }

    //renderLayers.depthTexture = gl.createTexture();
    
    {
      renderLayers.midTexture = gl.createTexture();
      gl.bindTexture( gl.TEXTURE_2D, renderLayers.midTexture );
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, renderLayers.width, renderLayers.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
     
      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

  }

  gl.useProgram( glState.program );

  //resize the back texture
  let targetWidth = gnv.width,
    targetHeight = gnv.height;
  if( targetLayer !== null ) {
    targetWidth = targetLayer.w;
    targetHeight = targetLayer.h;
  }
  if( renderLayers.width !== targetWidth || renderLayers.height !== targetHeight ) {
    renderLayers.width = targetWidth;
    renderLayers.height = targetHeight;
    gl.bindTexture( gl.TEXTURE_2D, renderLayers.backTexture );
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, renderLayers.width, renderLayers.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture( gl.TEXTURE_2D, renderLayers.midTexture );
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, renderLayers.width, renderLayers.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  
  //No depth bound! :-O
  //gl.bindTexture( gl.TEXTURE_2D, renderLayers.depthTexture );
  //gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, renderLayers.depthTexture, level);

  //clear both buffers
  {
    gl.bindTexture( gl.TEXTURE_2D, renderLayers.backTexture );
    // attach the back texture as the first color attachment
    gl.bindFramebuffer( gl.FRAMEBUFFER, renderLayers.framebuffer );
    const attachmentPoint = gl.COLOR_ATTACHMENT0, level = 0;
    gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, renderLayers.backTexture, level);
    gl.viewport( 0, 0, targetWidth, targetHeight );
    gl.clearColor( ...backgroundRGBA );
    gl.clear( gl.COLOR_BUFFER_BIT );
  }
  {
    gl.bindTexture( gl.TEXTURE_2D, renderLayers.midTexture );
    // attach the back texture as the first color attachment
    gl.bindFramebuffer( gl.FRAMEBUFFER, renderLayers.midFramebuffer );
    const attachmentPoint = gl.COLOR_ATTACHMENT0, level = 0;
    gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, renderLayers.midTexture, level);
    gl.viewport( 0, 0, targetWidth, targetHeight );
    gl.clearColor( ...backgroundRGBA );
    gl.clear( gl.COLOR_BUFFER_BIT );
  }
  
  gl.disable( gl.DEPTH_TEST );
  gl.disable( gl.BLEND );

  gl.bindVertexArray(glState.vao);

  let drewToMidTexture = false;
  for( const layer of visibleLayers ) {

    drewToMidTexture = !drewToMidTexture;

    if( drewToMidTexture === false ) {
      const attachmentPoint = gl.COLOR_ATTACHMENT0, level = 0;
      // attach the back texture as the first color attachment
      gl.bindFramebuffer( gl.FRAMEBUFFER, renderLayers.framebuffer );
      gl.bindTexture( gl.TEXTURE_2D, renderLayers.backTexture );
      gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, renderLayers.backTexture, level);
      gl.viewport( 0, 0, targetWidth, targetHeight );
    }
    if( drewToMidTexture === true ) {
      const attachmentPoint = gl.COLOR_ATTACHMENT0, level = 0;
      // attach the back texture as the first color attachment
      gl.bindFramebuffer( gl.FRAMEBUFFER, renderLayers.midFramebuffer );
      gl.bindTexture( gl.TEXTURE_2D, renderLayers.midTexture );
      gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, renderLayers.midTexture, level);
      gl.viewport( 0, 0, targetWidth, targetHeight );
    }
  
    //we don't call getTransform anywhere inside this function.
    //Prior functions can load the transform matrix as they like.

    let [x,y] = transformPoint( layer.topLeft ),
      [x2,y2] = transformPoint( layer.topRight ),
      [x3,y3] = transformPoint( layer.bottomLeft ),
      [x4,y4] = transformPoint( layer.bottomRight );
    //this unpacking and repacking is because of array re-use
    let xy = [x,y,1]; xy2 = [x2,y2,1]; xy3 = [x3,y3,1]; xy4 = [x4,y4,1];


    //transform the layer if we're mid-transform
    //(this will not affect us during e.g. export renders, because we won't be transforming)
    if( uiSettings.activeTool === "transform" && uiSettings.toolsSettings.transform.current === true && uiSettings.toolsSettings.transform.transformingLayers.includes( layer ) && ( cursor.mode !== "none" || pointers.count === 2 ) ) {
      getLayerTransform();
      let [x,y] = transformLayerPoint( xy ),
        [x2,y2] = transformLayerPoint( xy2 ),
        [x3,y3] = transformLayerPoint( xy3 ),
        [x4,y4] = transformLayerPoint( xy4 );
      xy = [x,y,1]; xy2 = [x2,y2,1]; xy3 = [x3,y3,1]; xy4 = [x4,y4,1];
      layer.transform.transformingPoints.topLeft = [...xy];
      layer.transform.transformingPoints.topRight = [...xy2];
      layer.transform.transformingPoints.bottomLeft = [...xy3];
      layer.transform.transformingPoints.bottomRight = [...xy4];
    }

    //get the layer's physical size on-display
    let layerSizePixels;
    {
      const dx = xy2[0] - xy[0], dy = xy2[1] - xy[1];
      layerSizePixels = Math.sqrt( dx**2 + dy**2 );
    }

    //convert that screenspace to GL space
    const glOriginX = targetWidth/2, glOriginY = targetHeight/2;
    for( const p of [xy,xy2,xy3,xy4] ) {
      p[0] -= glOriginX; p[1] -= glOriginY;
      p[0] /= glOriginX;
      //We're flipping the y coordinate! OpenGL NDC space defines the bottom of the screen as -1 y, and the top as +1 y (center 0).
      if( flipY === true ) p[1] /= -glOriginY;
      else p[1] /= glOriginY;
    }

    //update the vertex data
    //top-left triangle
    glState.vertices[0] = xy[0]; glState.vertices[1] = xy[1];
    glState.vertices[4] = xy2[0]; glState.vertices[5] = xy2[1];
    glState.vertices[8] = xy3[0]; glState.vertices[9] = xy3[1];
    //bottom-right triangle
    glState.vertices[12] = xy2[0]; glState.vertices[13] = xy2[1];
    glState.vertices[16] = xy4[0]; glState.vertices[17] = xy4[1];
    glState.vertices[20] = xy3[0]; glState.vertices[21] = xy3[1];
    //push the updated vertex data to the GPU
    gl.bindBuffer( gl.ARRAY_BUFFER, glState.vertexBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, glState.vertices, gl.STREAM_DRAW );

    //do I need to re-enable the vertex array??? Let's assume so, then try coding this out later
    gl.enableVertexAttribArray( glState.xyuvInputIndex );
    {
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( glState.xyuvInputIndex, size, dType, normalize, stride, offset );
    }

    //let's bind the layer's texture
    gl.activeTexture( gl.TEXTURE0 + 0 );
    gl.bindTexture( gl.TEXTURE_2D, layer.glTexture );
    if( layer.layerType !== "group" && layer.textureChanged ) {
      //let's re-upload the layer's texture when it's changed
      const mipLevel = 0,
      internalFormat = gl.RGBA,
      //internalFormat = gl.RGBA16F,
      srcFormat = gl.RGBA,
      srcType = gl.UNSIGNED_BYTE;
      gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, layer.canvas );
      layer.textureChanged = false;
    }
    //point the layer's source image at texture 0
    gl.uniform1i( gl.getUniformLocation( glState.program, "img" ), 0 );

    //bind the layer's mask
    gl.activeTexture( gl.TEXTURE0 + 1 );
    gl.bindTexture( gl.TEXTURE_2D, layer.glMask );
    if( layer.layerType !== "group" && layer.maskChanged ) {
      //re-upload the layer's mask when it's changed
      const mipLevel = 0,
      internalFormat = gl.RGBA,
      //internalFormat = gl.RGBA16F,
      srcFormat = gl.RGBA,
      srcType = gl.UNSIGNED_BYTE;
      gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, layer.maskCanvas );
      layer.maskChanged = false;
    }
    //point the mask at texture 1
    gl.uniform1i( gl.getUniformLocation( glState.program, "imgMask" ), 1 );

    //bind the previous render result as the canvas
    gl.activeTexture( gl.TEXTURE0 + 2 );
    if( drewToMidTexture === false ) { gl.bindTexture( gl.TEXTURE_2D, renderLayers.midTexture ); }
    if( drewToMidTexture === true ) { gl.bindTexture( gl.TEXTURE_2D, renderLayers.backTexture ); }
    //point canvas at texture 2
    gl.uniform1i( gl.getUniformLocation( glState.program, "canvas" ), 2 );


    //set the layer's alpha
    gl.uniform1f( glState.alphaInputIndex, getLayerOpacity( layer ) );
    let maskVisibility = 0.0;
    if( layer === selectedLayer && uiSettings.activeTool === "mask" && layer.maskInitialized )
      maskVisibility = 0.5;
    gl.uniform1f( glState.alphaMaskIndex, maskVisibility );
    gl.uniform1f( glState.timeIndex, floatTime );

    let borderIsVisible = layer === selectedLayer;

    //disable border while transform group to avoid recalculating coordinates every cycle (and visuals are confusing anyway)
    if( layer.layerType === "group" && uiSettings.activeTool === "transform" && uiSettings.toolsSettings.transform.current === true && ( cursor.mode !== "none" || pointers.count === 2 ) )
      borderIsVisible = false;

    if( borderIsVisible === false && layersWithVisibleBorders.includes( layer ) )
      borderIsVisible = true;

    if( showBorders === false )
      borderIsVisible = false;

    gl.uniform1f( glState.borderVisibilityIndex, borderIsVisible ? 0.33 : 0.0 );
    gl.uniform1f( glState.borderWidthIndex, 2.0 / layerSizePixels ); //2 pixel border width

    {
      //and draw our triangles
      const primitiveType = gl.TRIANGLES,
        structStartOffset = 0,
        structCount = 6;
      gl.drawArrays( primitiveType, structStartOffset, structCount );
    }
    
    //blit from the current framebuffer to whichever texture we're not using
    if( drewToMidTexture === false ) {
      gl.bindFramebuffer( gl.READ_FRAMEBUFFER, renderLayers.framebuffer );
      gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, renderLayers.midFramebuffer );
      gl.blitFramebuffer( 0,0,targetWidth,targetHeight, 0,0,targetWidth,targetHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST );
    }
    if( drewToMidTexture === true ) {
      gl.bindFramebuffer( gl.READ_FRAMEBUFFER, renderLayers.midFramebuffer );
      gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, renderLayers.framebuffer );
      gl.blitFramebuffer( 0,0,targetWidth,targetHeight, 0,0,targetWidth,targetHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST );
    }

  }


  //draw the backtexture to the screen as if it was a layer
  {
    if( targetLayer === null ) {
      //render to the screen canvas
      gl.bindFramebuffer( gl.FRAMEBUFFER, null );
    }
    else {
      const attachmentPoint = gl.COLOR_ATTACHMENT0, level = 0;
      gl.bindFramebuffer( gl.FRAMEBUFFER, renderLayers.framebuffer );
      gl.bindTexture( gl.TEXTURE_2D, targetLayer.glTexture );
      //resize (and clear) the target layer's texture
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, targetWidth, targetHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      // render to the target layer's texture
      gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, targetLayer.glTexture, level);
      gl.viewport( 0, 0, targetWidth, targetHeight );
    }
    gl.viewport( 0, 0, targetWidth, targetHeight );
    gl.clearColor( ...backgroundRGBA ); //never seen tho
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
    gl.disable( gl.DEPTH_TEST );
    gl.disable( gl.BLEND );
  
    //update the vertex data
    //top-left triangle
    glState.vertices[0] = -1; glState.vertices[1] = -1;
    glState.vertices[4] = 1; glState.vertices[5] = -1;
    glState.vertices[8] = -1; glState.vertices[9] = 1;
    //bottom-right triangle
    glState.vertices[12] = 1; glState.vertices[13] = -1;
    glState.vertices[16] = 1; glState.vertices[17] = 1;
    glState.vertices[20] = -1; glState.vertices[21] = 1;
    //push the updated vertex data to the GPU
    gl.bindBuffer( gl.ARRAY_BUFFER, glState.vertexBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, glState.vertices, gl.STREAM_DRAW );

    gl.enableVertexAttribArray( glState.xyuvInputIndex );
    {
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( glState.xyuvInputIndex, size, dType, normalize, stride, offset );
    }

    //bind the backtexture as the layer's source
    gl.activeTexture( gl.TEXTURE0 + 0 );
    if( drewToMidTexture === false ) gl.bindTexture( gl.TEXTURE_2D, renderLayers.backTexture );
    if( drewToMidTexture === true ) gl.bindTexture( gl.TEXTURE_2D, renderLayers.midTexture );
    //point the layer's source image at texture 0
    gl.uniform1i( gl.getUniformLocation( glState.program, "img" ), 0 );

    //blank the mask (solid alpha)
    gl.activeTexture( gl.TEXTURE0 + 1 );
    gl.bindTexture( gl.TEXTURE_2D, renderLayers.blankTexture );
    gl.uniform1i( gl.getUniformLocation( glState.program, "imgMask" ), 1 );

    //blank or color the undercanvas (this is the base-mix color)
    {
      gl.activeTexture( gl.TEXTURE0 + 2 );
      gl.bindTexture( gl.TEXTURE_2D, renderLayers.colorTexture );
      const colorData = new Uint8ClampedArray( [ ...backgroundRGBA, ...backgroundRGBA, ...backgroundRGBA, ...backgroundRGBA ] );
      gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, colorData );
      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i( gl.getUniformLocation( glState.program, "canvas" ), 2 );
    }

    //set the layer's alpha
    gl.uniform1f( glState.alphaInputIndex, 1.0 );
    gl.uniform1f( glState.alphaMaskIndex, 0.0 );
    gl.uniform1f( glState.timeIndex, 0.0 );
    gl.uniform1f( glState.borderVisibilityIndex, 0.0 );
    gl.uniform1f( glState.borderWidthIndex, 2.0 / targetWidth ); //2 pixel border width (avoid div by zero can change IDK)

    {
      //and draw our screen-triangle
      const primitiveType = gl.TRIANGLES, structStartOffset = 0, structCount = 6;
      gl.drawArrays( primitiveType, structStartOffset, structCount );
    }

  }

}

let storage;

async function setup() {

    document.body.appendChild( main );
    //main.appendChild( cnv );
    main.appendChild( gnv );
    uiContainer.appendChild( underlayContainer );
    main.appendChild( uiContainer );
    main.appendChild( overlayContainer );

    apiFlowsLoadAwaiter.then(
      () => {
        //console.log( "APIFlows length: ", apiFlows.length );
        executeAPICall( "Local Brushes Loader" ).then( result => {
          if( typeof result === "object" && Array.isArray( result[ "brushes-list" ] ) ) {
            //console.log( "Got brushes result: ", result );
            let loadedBrush = false;
            if( uiSettings.lastUsedAssets.hasOwnProperty( "Brushes" ) ) {
              const lastUsedBrushId = uiSettings.lastUsedAssets.Brushes;
              const brushAsset = assetsLibrary.Brushes.find( ({uniqueId}) => uniqueId === lastUsedBrushId );
              if( brushAsset ) {
                loadBrush( brushAsset );
                loadedBrush = true;
              }
            }
            else if( assetsLibrary.Brushes.length > 0 ) {
              loadBrush( assetsLibrary.Brushes[ 0 ])
            }
          } else {
            console.error( "Failed to load default brushes? Result: ", result );
          }
        } );

        setupUIGenerativeToolsPanel();

      }
    );

    const img = new Image();
    img.src = "paper.png";
    img.onload = async () => {
      //paperTexture = ctx.createPattern( img, "repeat" );
      //setup GL temporarily inside img onload for texture test
      setupGL( img );  
      setupGLAlphaRender(); //no errors on setup, good sign
      setupGLLassoPreview();
      setupPaintGPU2();
      setupLassoStack();
  
    }


    setupUI();

    resizeCanvases();

    window.addEventListener( "resize", resizeCanvases );

    window.addEventListener( "beforunload", () => {
      if( uiSettings.unsavedChanges === true ) return "Close current project? Unsaved data will be lost.";
      else return undefined;
    } );

    //populate demopoints
    //for( let i=0; i<10; i++ ) { demoPoints.push( [ Math.random()*W , Math.random()*H , 1 ] ); }
    {
        let w = 1024, h = 1024;
        let x1 = W/2 - w/2, y1 = H/2 - h/2,
            x2 = W/2 + w/2, y2 = H/2 + h/2;
        //demoPoints.push( [ 0 , 0 , 1 ] , [ W , 0 , 1 ] , [ W, H , 1 ] , [ 0 , H , 1 ] , [ 0 , 0 , 1 ], null );
        demoPoints.push( [ x1, y1 , 1 ] , [ x2, y1 , 1 ] , [ x2, y2 , 1 ] , [ x1, y2 , 1 ] , [ x1, y1 , 1 ], null );
    }

    window.onkeydown = k => {
      if( uiSettings.debugMode === true && k.code === "Escape" ) {
        looping = false;
        console.log( "Stopped looping." );
      }
    }

    gnv.addEventListener( "pointerdown" ,  p => startHandler( p ) );
    gnv.addEventListener( "pointermove" , p => moveHandler( p ) );
    gnv.addEventListener( "pointerup" , p => stopHandler( p ) );
    gnv.addEventListener( "pointerout" , p => stopHandler( p ) );
    gnv.addEventListener( "pointercancel" , p => stopHandler( p ) );
    gnv.addEventListener( "pointerleave" , p => stopHandler( p ) );
    gnv.addEventListener( "contextmenu" , p => contextMenuHandler( p ) );

    gnv.addEventListener( "auxclick" , p => cancelEvent );

    enableKeyTrapping();

    window.requestAnimationFrame( Loop );

    
    storage = await openStorage( "ParrotLUX-Storage" );
    await loadConservedSettings();

}

const cancelEvent = e => {
  e.preventDefault?.();
  e.stopPropagation?.();
  e.cancelBubble = true;
  e.returnValue = false;
  return false;
}

const glState = {
  ready: false,
  program: null,
  vertices: null,
  vertexBuffer: null,
  vao: null,
  paperTexture: null,
  xyuvInputIndex: null,

  alphaInputIndex: null,
  alphaMaskIndex: null,
  timeIndex: null,
  borderVisibilityIndex: null,
  borderWidthIndex: null,
  blendModeIndex: null,

  //these indices are an enum DO NOT REORGANIZE unless updating shader code
  layerBlendModes: [ "normal", "multiply", "add", "light & shadow" ],

};
function setupGL( testImageTexture ) {

  gl.disable(gl.DEPTH_TEST);
  
  gl.enable( gl.BLEND );
  gl.blendFunc( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA );

  gl.clearColor(0.5,0.5,0.5,1);
  gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

  const supported = gl.getSupportedExtensions();
  if( supported.indexOf( "EXT_color_buffer_float" ) === -1 ) {
    console.error( "EXT_color_buffer_float extension not supported!" );
  }
  if( supported.indexOf( "EXT_float_blend" ) === -1 ) {
    console.error( "EXT_float_blend extension not supported!" );
  }

  gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("EXT_float_blend");

  //push some code to the GPU
  const vertexShaderSource = `#version 300 es
    in vec4 xyuv;

    out vec2 xy;
    out vec2 uv;
    
    void main() {
      xy = xyuv.xy;
      uv = xyuv.zw;
      gl_Position = vec4(xyuv.xy,0.5,1);
    }`;
    const fragmentShaderSource = `#version 300 es
      precision highp float;
      
      uniform sampler2D img;
      uniform sampler2D imgMask;
      uniform sampler2D canvas;
  
      uniform float alpha;
      uniform float mask;
      uniform float time;
      uniform float borderVisibility;
      uniform float borderWidth;
      uniform int blendMode; //0 - normal, 1 - multiply
      in vec2 xy;
      in vec2 uv;
      out vec4 outColor;
      
      vec3 hsl2rgb( vec3 c ) {
          vec3 rgb = clamp( abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0 );
          return c.z + c.y * (rgb-0.5)*(1.0-abs(2.0*c.z-1.0));
      }
      vec3 rgb2hsl( vec3 c ){
        float h = 0.0;
        float s = 0.0;
        float l = 0.0;
        float r = c.r;
        float g = c.g;
        float b = c.b;
        float cMin = min( r, min( g, b ) );
        float cMax = max( r, max( g, b ) );
      
        l = ( cMax + cMin ) / 2.0;
        if ( cMax > cMin ) {
          float cDelta = cMax - cMin;
              
              //s = l < .05 ? cDelta / ( cMax + cMin ) : cDelta / ( 2.0 - ( cMax + cMin ) ); Original
          s = l < .0 ? cDelta / ( cMax + cMin ) : cDelta / ( 2.0 - ( cMax + cMin ) );
              
          if ( r == cMax ) {
            h = ( g - b ) / cDelta;
          } else if ( g == cMax ) {
            h = 2.0 + ( b - r ) / cDelta;
          } else {
            h = 4.0 + ( r - g ) / cDelta;
          }
      
          if ( h < 0.0) {
            h += 6.0;
          }
          h = h / 6.0;
        }
        return vec3( h, s, l );
      }
  
      void main() {
  
        vec4 canvasLookup = texture( canvas, ( xy + 1.0 ) * 0.5 );
  
        vec4 lookup = texture( img, uv );
        vec4 maskLookup = texture( imgMask, uv );
        lookup.a *= alpha * maskLookup.a;
  
        float borderShade = abs( mod( ( ( time - ( uv.x + uv.y ) ) * 0.1 / borderWidth ), 2.0 ) - 1.0 );
  
        float onBorder = float( uv.x < borderWidth || uv.x > (1.0-borderWidth) || uv.y < borderWidth || uv.y > (1.0-borderWidth) );
  
        vec4 mainColor = mix( lookup, vec4( vec3(borderShade), 1.0 ), onBorder * borderVisibility );
        vec4 maskColor = vec4( mix( vec3( 1.0 ), vec3( borderShade ), 0.5 ), mask * maskLookup.a );
  
        //draw the mask under our mainColor, and with the mask 50% opacity, still see the layer beneath
        vec4 compositeColor = vec4(
          mix(
            mix(
              maskColor.rgb,
              mainColor.rgb,
              ( 1.0 - maskColor.a )
            ),
            mainColor.rgb,
            mainColor.a
          ),
          clamp( mainColor.a + maskColor.a, 0.0, 1.0 )
        );
  
        /* vec3 adjustedColor = rgb2hsl( compositeColor.rgb );
        //hsl
        //have to think through how to scale these toward 100% though
        //adjustedColor.x = clamp( mod( adjustedColor.x + time, 1.0 ), 0.0, 1.0 );
        //adjustedColor.y = clamp( mod( adjustedColor.y + time * 10.0, 1.0 ), 0.0, 1.0 );
        //adjustedColor.z = clamp( mod( adjustedColor.z + time * 10.0, 1.0 ), 0.0, 1.0 );
        adjustedColor = hsl2rgb( adjustedColor );
        contrastFactor = 1.0; //Just increase for more contrast. Probably a better way though.
        adjustedColor.r = clamp( contrastFactor * ( adjustedColor.r - 0.5 ) + 0.5, 0.0, 1.0 );
        adjustedColor.g = clamp( contrastFactor * ( adjustedColor.g - 0.5 ) + 0.5, 0.0, 1.0 );
        adjustedColor.b = clamp( contrastFactor * ( adjustedColor.b - 0.5 ) + 0.5, 0.0, 1.0 );
  
        compositeColor = vec4( adjustedColor, compositeColor.a ); */
  
        if( compositeColor.a == 0.0 && canvasLookup.a == 0.0 ) discard;
  
        //float totalAlpha = clamp( compositeColor.a + canvasLookup.a, 0.0, 1.0 );
        float totalAlpha = clamp( compositeColor.a + canvasLookup.a, 0.0, 1.0 );
        float compositeWeight = compositeColor.a / totalAlpha;
        float canvasWeight = ( totalAlpha - compositeColor.a ) / totalAlpha;

        if( blendMode == 1 ) {
          compositeColor.r *= canvasLookup.r;
          compositeColor.g *= canvasLookup.g;
          compositeColor.b *= canvasLookup.b;
        }
        if( blendMode == 2 ) {
          compositeColor.r = clamp( compositeColor.r + canvasLookup.r, 0.0, 1.0 );
          compositeColor.g = clamp( compositeColor.g + canvasLookup.g, 0.0, 1.0 );
          compositeColor.b = clamp( compositeColor.b + canvasLookup.b, 0.0, 1.0 );
        }
        if( blendMode == 3 ) {
          compositeColor.r = clamp( compositeColor.r*2.0 * canvasLookup.r, 0.0, 1.0 );
          compositeColor.g = clamp( compositeColor.g*2.0 * canvasLookup.g, 0.0, 1.0 );
          compositeColor.b = clamp( compositeColor.b*2.0 * canvasLookup.b, 0.0, 1.0 );
        }
  
        outColor = vec4(
          sqrt( ( compositeWeight * pow( compositeColor.r, 2.0 ) ) + ( canvasWeight * pow( canvasLookup.r, 2.0 ) ) ),
          sqrt( ( compositeWeight * pow( compositeColor.g, 2.0 ) ) + ( canvasWeight * pow( canvasLookup.g, 2.0 ) ) ),
          sqrt( ( compositeWeight * pow( compositeColor.b, 2.0 ) ) + ( canvasWeight * pow( canvasLookup.b, 2.0 ) ) ),
          totalAlpha
        );
  
        //totalAlpha = clamp( mainColor.a + canvasLookup.a, 0.0, 1.0 );
        /* compositeWeight = 0.0;
        canvasWeight = 1.0 - mainColor.a;
        outColor = vec4(
          sqrt( ( compositeWeight * pow( mainColor.r, 2.0 ) ) + ( canvasWeight * pow( canvasLookup.r, 2.0 ) ) ),
          sqrt( ( compositeWeight * pow( mainColor.g, 2.0 ) ) + ( canvasWeight * pow( canvasLookup.g, 2.0 ) ) ),
          sqrt( ( compositeWeight * pow( mainColor.b, 2.0 ) ) + ( canvasWeight * pow( canvasLookup.b, 2.0 ) ) ),
          1.0
        ); */
  
      }`;
  
  const old_fragmentShaderSource = `#version 300 es
    precision highp float;
    
    uniform sampler2D img;
    uniform sampler2D imgMask;
    uniform sampler2D canvas;

    uniform float alpha;
    uniform float mask;
    uniform float time;
    uniform float borderVisibility;
    uniform float borderWidth;
    in vec2 xy;
    in vec2 uv;
    out vec4 outColor;
    
    vec3 hsl2rgb( vec3 c ) {
        vec3 rgb = clamp( abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0 );
        return c.z + c.y * (rgb-0.5)*(1.0-abs(2.0*c.z-1.0));
    }
    vec3 rgb2hsl( vec3 c ){
      float h = 0.0;
      float s = 0.0;
      float l = 0.0;
      float r = c.r;
      float g = c.g;
      float b = c.b;
      float cMin = min( r, min( g, b ) );
      float cMax = max( r, max( g, b ) );
    
      l = ( cMax + cMin ) / 2.0;
      if ( cMax > cMin ) {
        float cDelta = cMax - cMin;
            
            //s = l < .05 ? cDelta / ( cMax + cMin ) : cDelta / ( 2.0 - ( cMax + cMin ) ); Original
        s = l < .0 ? cDelta / ( cMax + cMin ) : cDelta / ( 2.0 - ( cMax + cMin ) );
            
        if ( r == cMax ) {
          h = ( g - b ) / cDelta;
        } else if ( g == cMax ) {
          h = 2.0 + ( b - r ) / cDelta;
        } else {
          h = 4.0 + ( r - g ) / cDelta;
        }
    
        if ( h < 0.0) {
          h += 6.0;
        }
        h = h / 6.0;
      }
      return vec3( h, s, l );
    }

    void main() {

      vec4 canvasLookup = texture( canvas, ( xy + 1.0 ) * 0.5 );

      vec4 lookup = texture( img, uv );
      vec4 maskLookup = texture( imgMask, uv );
      lookup.a *= alpha * maskLookup.a;

      float borderShade = abs( mod( ( ( time - ( uv.x + uv.y ) ) * 0.1 / borderWidth ), 2.0 ) - 1.0 );

      float onBorder = float( uv.x < borderWidth || uv.x > (1.0-borderWidth) || uv.y < borderWidth || uv.y > (1.0-borderWidth) );

      vec4 mainColor = mix( lookup, vec4( vec3(borderShade), 1.0 ), onBorder * borderVisibility );
      vec4 maskColor = vec4( mix( vec3( 1.0 ), vec3( borderShade ), 0.5 ), mask * maskLookup.a );

      //draw the mask under our mainColor, and with the mask 50% opacity, still see the layer beneath
      vec4 compositeColor = vec4(
        mix(
          mix(
            maskColor.rgb,
            mainColor.rgb,
            ( 1.0 - maskColor.a )
          ),
          mainColor.rgb,
          mainColor.a
        ),
        clamp( mainColor.a + maskColor.a, 0.0, 1.0 )
      );

      /* vec3 adjustedColor = rgb2hsl( compositeColor.rgb );
      //hsl
      //have to think through how to scale these toward 100% though
      //adjustedColor.x = clamp( mod( adjustedColor.x + time, 1.0 ), 0.0, 1.0 );
      //adjustedColor.y = clamp( mod( adjustedColor.y + time * 10.0, 1.0 ), 0.0, 1.0 );
      //adjustedColor.z = clamp( mod( adjustedColor.z + time * 10.0, 1.0 ), 0.0, 1.0 );
      adjustedColor = hsl2rgb( adjustedColor );
      contrastFactor = 1.0; //Just increase for more contrast. Probably a better way though.
      adjustedColor.r = clamp( contrastFactor * ( adjustedColor.r - 0.5 ) + 0.5, 0.0, 1.0 );
      adjustedColor.g = clamp( contrastFactor * ( adjustedColor.g - 0.5 ) + 0.5, 0.0, 1.0 );
      adjustedColor.b = clamp( contrastFactor * ( adjustedColor.b - 0.5 ) + 0.5, 0.0, 1.0 );

      compositeColor = vec4( adjustedColor, compositeColor.a ); */

      if( compositeColor.a == 0.0 && canvasLookup.a == 0.0 ) discard;

      //float totalAlpha = clamp( compositeColor.a + canvasLookup.a, 0.0, 1.0 );
      float totalAlpha = clamp( compositeColor.a + canvasLookup.a, 0.0, 1.0 );
      float compositeWeight = compositeColor.a / totalAlpha;
      float canvasWeight = ( totalAlpha - compositeColor.a ) / totalAlpha;

      outColor = vec4(
        sqrt( ( compositeWeight * pow( compositeColor.r, 2.0 ) ) + ( canvasWeight * pow( canvasLookup.r, 2.0 ) ) ),
        sqrt( ( compositeWeight * pow( compositeColor.g, 2.0 ) ) + ( canvasWeight * pow( canvasLookup.g, 2.0 ) ) ),
        sqrt( ( compositeWeight * pow( compositeColor.b, 2.0 ) ) + ( canvasWeight * pow( canvasLookup.b, 2.0 ) ) ),
        totalAlpha
      );

      //totalAlpha = clamp( mainColor.a + canvasLookup.a, 0.0, 1.0 );
      /* compositeWeight = 0.0;
      canvasWeight = 1.0 - mainColor.a;
      outColor = vec4(
        sqrt( ( compositeWeight * pow( mainColor.r, 2.0 ) ) + ( canvasWeight * pow( canvasLookup.r, 2.0 ) ) ),
        sqrt( ( compositeWeight * pow( mainColor.g, 2.0 ) ) + ( canvasWeight * pow( canvasLookup.g, 2.0 ) ) ),
        sqrt( ( compositeWeight * pow( mainColor.b, 2.0 ) ) + ( canvasWeight * pow( canvasLookup.b, 2.0 ) ) ),
        1.0
      ); */

    }`;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader,vertexShaderSource);
    gl.compileShader(vertexShader);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader,fragmentShaderSource);
    gl.compileShader(fragmentShader);

    const program = gl.createProgram();
    gl.attachShader(program,vertexShader);
    gl.attachShader(program,fragmentShader);
    gl.linkProgram(program);
    glState.program = program;

    //push some vertex and UV data to the GPU
    const ccs = new Float32Array([
      //top-left triangle
      0,0, 0,0,
      1,0, 1,0,
      0,1, 0,1,
      //bottom-right triangle
      1,0, 1,0,
      1,1, 1,1,
      0,1, 0,1,
    ]);
    const xyuvInputIndex = gl.getAttribLocation( program, "xyuv" );
    glState.xyuvInputIndex = xyuvInputIndex;
    const xyBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,xyBuffer);
    gl.bufferData( gl.ARRAY_BUFFER, ccs, gl.STATIC_DRAW );
    glState.vertices = ccs;
    glState.vertexBuffer = xyBuffer;

    glState.alphaInputIndex = gl.getUniformLocation( program, "alpha" );
    glState.alphaMaskIndex = gl.getUniformLocation( program, "mask" );
    glState.timeIndex = gl.getUniformLocation( program, "time" );
    glState.borderVisibilityIndex = gl.getUniformLocation( program, "borderVisibility" );
    glState.borderWidthIndex = gl.getUniformLocation( program, "borderWidth" );
    glState.blendModeIndex = gl.getUniformLocation( program, "blendMode" );

    //set up a data-descriptor
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    glState.vao = vao;

    //push a description of our vertex data's structure
    gl.enableVertexAttribArray( xyuvInputIndex );
    {
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( xyuvInputIndex, size, dType, normalize, stride, offset );
    }

    //upload our paper texture
    const texture = gl.createTexture();
    gl.activeTexture( gl.TEXTURE0 + 0 );
    gl.bindTexture( gl.TEXTURE_2D, texture );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );
    glState.paperTexture = texture;
    {
      const mipLevel = 0,
        internalFormat = gl.RGBA,
        srcFormat = gl.RGBA,
        srcType = gl.UNSIGNED_BYTE;
      gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, testImageTexture );
    }

    glState.ready = true;

}

const glStateAlphaRender = {
  ready: false,
  program: null,
  vertices: null,
  vertexBuffer: null,
  vao: null,
  xyuvInputIndex: null,
};
function setupGLAlphaRender() {

  gl.disable(gl.DEPTH_TEST);
  
  gl.enable( gl.BLEND );
  gl.blendFunc( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA );

  gl.clearColor(0,0,0,0);
  gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

  //push some code to the GPU
  const vertexShaderSource = `#version 300 es
    in vec4 xyuv;

    out vec2 xy;
    out vec2 uv;
    
    void main() {
      xy = xyuv.xy;
      uv = xyuv.zw;
      gl_Position = vec4(xyuv.xy,0.5,1);
    }`;
  const fragmentShaderSource = `#version 300 es
    precision highp float;
    
    uniform sampler2D img;
    uniform vec3 color;

    in vec2 xy;
    in vec2 uv;

    out vec4 outColor;
    
    void main() {

      vec4 lookup = texture( img, uv );
      
      outColor = vec4( color, lookup.a );

    }`;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader,vertexShaderSource);
    gl.compileShader(vertexShader);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader,fragmentShaderSource);
    gl.compileShader(fragmentShader);

    const program = gl.createProgram();
    gl.attachShader(program,vertexShader);
    gl.attachShader(program,fragmentShader);
    gl.linkProgram(program);
    glStateAlphaRender.program = program;

    //push some vertex and UV data to the GPU
    const ccs = new Float32Array([
      //top-left triangle
      0,0, 0,0,
      1,0, 1,0,
      0,1, 0,1,
      //bottom-right triangle
      1,0, 1,0,
      1,1, 1,1,
      0,1, 0,1,
    ]);
    const xyuvInputIndex = gl.getAttribLocation( program, "xyuv" );
    glStateAlphaRender.xyuvInputIndex = xyuvInputIndex;
    const xyBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,xyBuffer);
    gl.bufferData( gl.ARRAY_BUFFER, ccs, gl.STATIC_DRAW );
    glStateAlphaRender.vertices = ccs;
    glStateAlphaRender.vertexBuffer = xyBuffer;

    //set up a data-descriptor
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    glStateAlphaRender.vao = vao;

    //push a description of our vertex data's structure
    gl.enableVertexAttribArray( xyuvInputIndex );
    {
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( xyuvInputIndex, size, dType, normalize, stride, offset );
    }

    glStateAlphaRender.ready = true;

}

const glStateLassoPreview = {
  ready: false,
  program: null,
  vertices: null,
  vertexBuffer: null,
  vao: null,
  xyuvInputIndex: null,
};
function setupGLLassoPreview() {

  gl.disable(gl.DEPTH_TEST);
  
  gl.enable( gl.BLEND );
  gl.blendFunc( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA );

  gl.clearColor(0,0,0,0);
  gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

  //push some code to the GPU
  const vertexShaderSource = `#version 300 es
    in vec4 xyuv;

    out vec2 xy;
    out vec2 uv;
    
    void main() {
      xy = xyuv.xy;
      uv = xyuv.zw;
      gl_Position = vec4(xyuv.xy,0.5,1);
    }`;
  const fragmentShaderSource = `#version 300 es
    precision highp float;
    
    uniform sampler2D img;
    uniform float time;
    uniform float invert;

    in vec2 xy;
    in vec2 uv;

    out vec4 outColor;
    
    void main() {

      vec4 lookup = texture( img, uv );
      
      float borderShade = abs( mod( ( ( time - ( uv.x + uv.y ) ) * 0.1 / 0.002 ), 2.0 ) - 1.0 );

      outColor = vec4( vec3( borderShade ), clamp( abs( invert - lookup.a ), 0.0, 1.0 ) * 0.25 );

    }`;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader,vertexShaderSource);
    gl.compileShader(vertexShader);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader,fragmentShaderSource);
    gl.compileShader(fragmentShader);

    const program = gl.createProgram();
    gl.attachShader(program,vertexShader);
    gl.attachShader(program,fragmentShader);
    gl.linkProgram(program);
    glStateLassoPreview.program = program;

    //push some vertex and UV data to the GPU
    const ccs = new Float32Array([
      //top-left triangle
      0,0, 0,0,
      1,0, 1,0,
      0,1, 0,1,
      //bottom-right triangle
      1,0, 1,0,
      1,1, 1,1,
      0,1, 0,1,
    ]);
    const xyuvInputIndex = gl.getAttribLocation( program, "xyuv" );
    glStateLassoPreview.xyuvInputIndex = xyuvInputIndex;
    const xyBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,xyBuffer);
    gl.bufferData( gl.ARRAY_BUFFER, ccs, gl.STATIC_DRAW );
    glStateLassoPreview.vertices = ccs;
    glStateLassoPreview.vertexBuffer = xyBuffer;

    //set up a data-descriptor
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    glStateLassoPreview.vao = vao;

    //push a description of our vertex data's structure
    gl.enableVertexAttribArray( xyuvInputIndex );
    {
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( xyuvInputIndex, size, dType, normalize, stride, offset );
    }

    glStateLassoPreview.ready = true;

}


const airInput = {
  active: false,
  started: { x:0, y:0 },
  current: { x:0, y:0 },
  color: new Uint8Array(4), //set in renderloop
  eyeDropperRadius: 20,
  insideEyedropperRadius: false,
  updateEyedropper: () => {

    if( airInput.insideEyedropperRadius === false ) {
      airInput.colorRing.style.display = "none";
      airInput.colorRing.style.borderColor = "transparent";
      return;
    }

    //get the eyedropper color
    let { x, y } = airInput.current;
    x *= devicePixelRatio;
    y *= devicePixelRatio;
    gl.bindFramebuffer( gl.FRAMEBUFFER, null );
    gl.readPixels( parseInt( x ), parseInt( gnv.height - y ), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, airInput.color );
    airInput.colorRing.style.display = "block";
    airInput.colorRing.style.borderColor = `rgb(${airInput.color[0]},${airInput.color[1]},${airInput.color[2]})`;
  },
  uiElement: null,
  colorRing: null,
}
function beginAirInput( p ) {
  airInput.active = true;
  airInput.started.x = p.clientX;
  airInput.started.y = p.clientY;
  airInput.uiElement.uiActive = true;
  airInput.uiElement.style.display = "block";
  airInput.uiElement.style.left = p.clientX + "px";
  airInput.uiElement.style.top = p.clientY + "px";
  inputAirInput( p );
}
function inputAirInput( p ) {
  airInput.current.x = p.clientX;
  airInput.current.y = p.clientY;
  const dx = airInput.current.x - airInput.started.x,
    dy = airInput.current.y - airInput.started.y,
    d = Math.sqrt( dx*dx + dy*dy );
  airInput.insideEyedropperRadius = ( d < airInput.eyeDropperRadius );
}
function endAirInput( p ) {
  if( airInput.insideEyedropperRadius ) {
    const [ r,g,b ] = airInput.color;
    const [ h,s,l ] = rgbToHsl( r, g, b );
    uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.h = h;
    uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.s = s;
    uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.l = l;
    document.querySelector( ".paint-tools-options-color-well" ).style.backgroundColor = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.getColorStyle();
  }
  airInput.insideEyedropperRadius = false;
  airInput.active = false;
  airInput.started.x = 0;
  airInput.started.y = 0;
  airInput.current.x = 0;
  airInput.current.y = 0;
  airInput.uiElement.style.display = "none";
}


let initialSettings = true;
function makeConservedSettingsObject() {
  const snapshot = {};
  for( const key of conservedSettingsKeys ) {
    const value = uiSettings[ key ];
    if( typeof value === "object" )
      snapshot[ key ] = JSON.parse( JSON.stringify( value ) );
    else snapshot[ key ] = value;
  }
  return snapshot;
}
function loadConservedSettingsObject( snapshot ) {
  for( const key of conservedSettingsKeys ) {
    const value = snapshot[ key ];
    if( typeof value === "object" )
      uiSettings[ key ] = JSON.parse( JSON.stringify( value ) );
    else if( value === undefined ) {}
    else uiSettings[ key ] = value;
  }
}

async function resetConservedSettings() {
  await storage.delete( "conservedSettings" );
  loadConservedSettingsObject( initialSettings );
  await conserveSettings();
}

async function conserveSettings() {
  const snapshot = makeConservedSettingsObject();
  await storage.set( "conservedSettings", snapshot );
  return true;
}

async function loadConservedSettings() {
  if( initialSettings === true ) {
    //snapshot initial settings for reset
    initialSettings = makeConservedSettingsObject();
  }

  if( false ){
    await resetConservedSettings();
    console.error( "loadConservedSettings() is auto-resetting persistent settings! (in debug mode).")
  }
  const haveConservedSettings = await storage.has( "conservedSettings" );
  if( ! haveConservedSettings ) {
    await conserveSettings();
  }

  //console.log( await storage.get( "conservedSettings" ) );
  const snapshot = ( await storage.get( "conservedSettings" ) );
  loadConservedSettingsObject( snapshot );

  //save updated version (may add new keys)
  await conserveSettings();

  return true;
}

//these settings are not included in a save file
const nonSavedSettingsPaths = [
  "toolsSettings.paint.modeSettings.all.brushTipsImages",
  "toolsSettings.paint.modeSettings.all.brushTexturesImages",
  "toolsSettings.transform",
  "maxUndoSteps",
  "defaultLayerWidth", "defaultLayerHeight",
  "addTimeStampToFilename",
  "gpuPaint", "showDebugInfo",
  "apiFlowVariables",
  "paintBusyTimeout",
  "clickTimeMS",
  "retryAPIDelay",

  "alwaysLockCanvasRotate",
  "lockCanvasRotate",
  "lockCanvasZoom",
  "lockTransformRotate",
  "lockTransformZoom",
  "unsavedChanges",
  "debugMode",
];

//these settings persist across app close/open
//(untested for Android APK!)
const conservedSettingsKeys = [
  "maxUndoSteps",
  "defaultLayerWidth", "defaultLayerHeight",
  "addTimeStampToFilename",
  "generativeControls",
  "paintBusyTimeout",
  "clickTimeMS",
  "retryAPIDelay",
  "apiFlowVariables",
  "alwaysLockCanvasRotate",
  //"lockCanvasRotate",
  //"lockCanvasZoom",
  //"lockTransformRotate",
  //"lockTransformZoom",
];

let uiSettings = {

  version: "0.1a.001",

  filename: "[automatic]",

  currentTimeSeekIndex: 0,

  gpuPaint: 2,
  showDebugInfo: false,

  maxUndoSteps: 20,
  defaultLayerWidth: 1024,
  defaultLayerHeight: 1024,
  addTimeStampToFilename: true,

  alwaysLockCanvasRotate: false,
  lockCanvasRotate: false,
  lockCanvasZoom: false,
  lockTransformRotate: false,
  lockTransformZoom: false,
  unsavedChanges: false,

  defaultAPIFlowName: null,
  generativeControls: {},
  apiFlowNamesUsed: [],
  defaultFilterName: "basic",
  defaultTextInfo: [
    [ "font-family", "sans-serif" ],
    [ "font-size", "48px" ],
    [ "text-align", "center" ],
    [ "color", "black" ],
  ],

 //how long to pause after a paint stroke before updating the layer's frame
  paintBusyTimeout: 1000,
  clickTimeMS: 350,
  retryAPIDelay: 2000,
  debugMode: false,

  apiFlowVariables: [
    {
      "key": "ComfyHost",
      "value": "localhost",
      "permissions": ["Comfy SD1.5/SDXL ControlNet","Comfy SD1.5/SDXL txt2img","Comfy SD1.5/SDXL img2img + ControlNet","Comfy SD1.5/SDXL img2img","Comfy StableCascade img2img + ControlNet","Comfy StableCascade img2img","Comfy StableCascade txt2img","Comfy Asset Loaders",],
    },
    {
      "key": "ComfyPort",
      "value": 8188,
      "permissions": ["Comfy SD1.5/SDXL ControlNet","Comfy SD1.5/SDXL txt2img","Comfy SD1.5/SDXL img2img + ControlNet","Comfy SD1.5/SDXL img2img","Comfy StableCascade img2img + ControlNet","Comfy StableCascade img2img","Comfy StableCascade txt2img","Comfy Asset Loaders",],
    },
    {
      "key": "A1111Host",
      "value": "localhost",
      "permissions": ["A1111 ControlNet Preprocessors Asset Loader","A1111 VAEs Asset Loader","A1111 txt2img + ControlNet","A1111 txt2img","A1111 Samplers Asset Loader","A1111 ControlNet Preprocessor","A1111 Models Asset Loader","A1111 img2img + ControlNet","A1111 img2img","A1111 ControlNet Models Asset Loader","A1111 Layer to Pose","A1111 Layer to Lineart"],
    },
    {
      "key": "A1111Port",
      "value": 7860,
      "permissions": ["A1111 ControlNet Preprocessors Asset Loader","A1111 VAEs Asset Loader","A1111 txt2img + ControlNet","A1111 txt2img","A1111 Samplers Asset Loader","A1111 ControlNet Preprocessor","A1111 Models Asset Loader","A1111 img2img + ControlNet","A1111 img2img","A1111 ControlNet Models Asset Loader","A1111 Layer to Pose","A1111 Layer to Lineart"],
    },
    {
      "key": "AppHost",
      "value": "localhost",
      "permissions": ["Local Brushes Loader",],
    },
    {
      "key": "AppPort",
      "value": 6789,
      "permissions": ["Local Brushes Loader",],
    },
    {
      "key": "StabilityAI-APIKey",
      "value": "",
      "permissions": ["SAI SD3 txt2img","SAI SD3 img2img",],
    },
  ],

  lastUsedAssets: {},

  nodeSnappingDistance: Math.min( innerWidth, innerHeight ) * 0.04, //~50px on a 1080p screen

  setActiveTool: tool => {
    console.error( "Set active tool: ", tool );
    uiSettings.activeTool = tool;
    UI.updateContext();
  },
  unsetActiveTool: tool => {
    console.error( "Unset active tool: ", tool );
    if( uiSettings.activeTool === tool )
      uiSettings.activeTool = null;
  },
  isActiveTool: tool => {
    return uiSettings.activeTool === tool;
  },

 //null | generate | paint | vector | mask | transform | flood-fill | text | pose | color-adjust | lasso
  activeTool: null,
  toolsSettings: {
    "generate": {},
    "paint": {
      setMode: mode => {
        uiSettings.toolsSettings.paint.mode = mode;
        UI.updateContext();
      },
      mode: "brush", //brush | erase | blend
      modeSettings: {
        "all": {
          "brushTips": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAFx0lEQVR42u2dwUtcRxzHP/tMIVQhwi4hB1Ewgjc9LHhY2INCIIIYBMGUQm892EP/gp4KCVIkhx56KQHb02JOQk5VWk8igpjkJmwPsR5isaAgKK3UHma0m9V1d3Xfvjcz3w/82Is83/t+Z+bNzJv5TQY/GQAG7W8f0AM8AHJAN9AF3AXu2L8/BU6AI+AA2Ac+ALvAe6AMbNtfr8h48Ay9QAEYAfLAMHAvpv91CLwFNoENYA3YQbS90I4DL4At4Czh2LL3Mu5JhUotk8BLYC8FpteKPXuPk7KrNQwBz+2798yxKNt7H5KNzTMBLDpoeq1YtM8k6jADrHhkfHWs2GcUVUwByx4bXx3L9pmDpwCUAjK+OkpWg+DIAs+A44DNP49jq0U2FPOngXUZfynWrTbekgPmZXTdmLdaecWY5737OEYLY76YP4v5qCJjm4tdq52zdAJzMvLWMWe1dIp+YEHmtSwWrKZOkAeWZFrLY8lqm2qK6uzF3jksptX8UWBVJsUeq1br1NV8md/eQlBM0ztfzX4yr4PE+wT96vAl3jFMbHTQqaFeaoaIicwTaJInXZNFbZ/elfDpirZNG49pbj+13w5i/4CUU48/9SODpj4ldzRZAL4FPkek+RtMB/BLHBefVg1zJlq+siiLlnG5trws28pXwDfAZ2phnaEHs+P511ZcrIBW77q62rjukvOogQLwNWYvvXCLu9a7WzGlmuR8TN2mBfhKFcl5buzhjGqPNzFzkxbgS1Ueb2jaywnVGu9iopkW4AtVGu+40tOrkhoNYTJhCf8YBt7VawGeSidvedpIC1AGHkorL/kdkzyzZgswKfO95iFVKeyqC8ATaeQ9T2q9AjKY/Lj3pZHX/InJm3xW3QI8lvlBcN96fekV8EjaBMOjqwrAqHQJhtHqPkAvJi++CIc+YOe8BShIj+AoVL4CRqRHcIxUFoC89AiOfGUf4ID4jlkR6eQQ6I4wc8MyPzzuAQMR5nQtESaD5y2ACJOByI4HRaBzARFmG5EIk54I82VIhMmDCA9z04uGyUWYs3RFmHRHmIOURZh0ZYC/gU+kRZD8kwH+RYceh8pZJA3CJsKkEhFhchoBJ9IhWE4i4Eg6BMtRhFkLIMLkIAL2pUOw7EeY3UAiTD5EmCzTIkx2I7QfIGTeR5h8ACJMyhGwLR2CZVvLwsPlYlk4KClUiLyF/3cGbUqP4NisLAAb0iM4NioLwJr0CI61ygKwA7yRJsHwxnr+UYaQ36RLMFx4XVkAlqVLMFx4rTRx4VEzTdwZ8Fr6eM/rc/OrCwCY8+iF33zksZJFh0XdZNEAi9LJWy55e1UBKEknbyk1UgDeAa+klXe8ouq0kFoFAOBn6eUdTXu6gk7a8iVWapl83d7AH1VpvOHGXi6r9jgf107x19sd/IMqj/Pc2sOSapGzUXdI30h+gO/RDmIXObHeXUtHAxf6A/gUKEpTp/gO+KlVF8sC62pSnYl161ldGk0R8xcwr0rlDPPWs1gurBqW7oi1ouY0Q5j6Gb/YM7+OYbaUS/B0xa71pi3MSvDUxWy7OxpzEj01MZdET7MTWJD4iceC9SIR+jGLDGVEMrFkPUiUvEYGifX4U3PeYxFYlSlti9U0Ts2PqhC0zfzUnvRe1Osg9mY/9R/l8uoYxtbhc+aM534NEVs+1OvHMTo1WdSySZ5OHGZW3w5uPLc/iyeMqXPYdGdvDM/IaT1Bw9/zvT7McxotL6u1jGuaQMgCz4BjGc+x1SJLgBQIe99ByWoQPFOEtQ1t2T6zqGLG89HCin1GUYcJTDoTX4xftM8kmmQIeI5JXOWa6WV770OysTVMAi+BvRSbvmfvcVJ2xUcGGAdeAFspMH3L3ss4Dp7C7sOx8b12KDWC+Vw6THzH3xxiTtrYxOTbX8Nm3Xa5NvnIADBof/uAHkx+3BzQDXQBd4E79u9PMdupjzDnJ+1j8ibvYo7VK2MO1/LuhLX/AG3nTKisCkvuAAAAAElFTkSuQmCC"],
          //"brushTextures": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAAAAACMmsGiAAAAEUlEQVQI12P8z8DAwMSAQgAAE1EBB5BfnioAAAAASUVORK5CYII="],
          "brushTextures": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAAAAACPAi4CAAANX0lEQVRYwwXBW4/j1mEA4EMeHl4O7xKpC6WRNDMa78zuer2xvUVSICkSu3AdoAZSBO1LgD60D33sb+mfadGkDy7gJnVcx3vJ7s5VI40kihIlkhLvh5d+H/VvZH/kGlVYg0Rgc1di20zFogMbCG6txbi2me/P3e7JNiH8xNCQMgMaAb5FtW2bnAYJBf/qXqRfRfBR7u5ENJdPjeXExi8rXBSrLtjpR/mKAbfp/rfXAxCOBZS7KTZ2VDJlvpMwU9IN+GtmFAZpVl9NeEMu2OKwWymDqNyzkgiRsiLZt3Rc+5uUVdRnlesylkrwUp8mAv1BW1O3MvxX4V7qi0z6bU+eYK7P7opGpMlpPz08bxbALNMsDk8KWem1F5pQFd0MdYip3KKG7hgMzkv4BYd3V4GYKzo8bHCLS61mCovITWheDXl6KRW7676mqQtlXlWaX5g3/GEvINZEU3+XwgT+ZSO/lo7kSTnzqYlU4nJfo4ACN9H2suntbiRVK07FdWxCoOoZyTOTAg7kSOrX0c36uC0yCzqotHiV+Muf9ktWwYA1AROw7hSg16oxXs+ZQm6pW1tlcQnIgA2wqCxvgaDj5OXmw4ELv6q3TCA5DUcpX7es6nBACWHFcPYfjFi1YZBMUISpfD+qRgbftfb/9Rwf3lNGhY9v/Ddbu+LgbzBjro+Vk95RWVwzmO8O1MOOnexbXeXjYZoJdz24rjj2jE6zJVqsrKfl9QKLfJVfjsPeGj6CX+bNqrwbCaotrRsfcp88EecuTwXe9m/nHKXjFTUnQdauLXmpdlTO0FZLsd4u0izRE7hbDjBsNDweeY5L9DC4GFGwXOYdJYROFYp9RBxk+FTLaPNpUBrUpNyzRqKQOAjxuO3i1eWnMnxhcmcuPN25iPJyyqOFCRTj71bOm4uRVB36zPrc6La4FRuJcj/cvLMDGk7U8xYUvBbHH+dL5qkJN2vEjwGyebvAGx8lSXDCtx4rQ+135KgF25sgAbXgxbeDgiWiQJKWakzdYHjtCKN8D7/Cml20V8FJScjRi8E6n9qDUQF6kHIOUD3kDZaN08bNhNutGJa1O3hftCMfsTrvjBu9NoS/8N5cQ2W1KeKmKkWgJ21oPfYcPyUNdVW7qykM4+HDIfgGduzSo3L/Hh4p1eReoo1GTQce/IegfETJ5T6O23zZwbnn1BqgNa3PchmM60QWSK3ZlqI3Kr9Z1SCG6aHYvc5Jm5Hia+LCf94dtNRt8ZKxvShPOU9sDY/vOlrWWE+41rI/LvLECKcVRxpw9upb/y8aZ7yj7DVtATsN5ZViwM8JbMCwccabSbPpzhwJcXekRmv66qERNLITxqAqYPoL+eR2gvoDUy/amHqb1SyrVIG255kt0xXdxebZoTPyF6TsxuQ+MxHB83q00WcG0fzYR2QnLe/Vs3GinUf4HbUsDeuVJTB1Hj6GL6Rst1GjqlazTcbySkxD0KhvW3nc93lag9yba+ZIcmYP9MWPkWW+v1Flb6UsmsdjBZv75g4ieaSEHl804gUtTVXFq4I0QmkWH7nUq/KCnqdaE8/Fu8g8qdBbQILlLJHVNHzBkiJoeiXz4+Z7fzjM7wkTc0o5Ref7CIsYvU01IVbxut4ba7S5ByIRCLke4YLZFAO6Ofh6E99jbmg14Rds3Y3qIOvVJHIjGa1sHcauAlcPV+nQ9JZ5lgmAfjgz8THJEs0ONtTHOSEH2W1cqLzDwy/0Kir+23jB8PLdKH4fCb7C1jw9XfJoX4RqrndIIZXN6r6XHqQC/z6IJVAW1HEqjiuSv13BX6STq5JntMZ80edj3rJISgrnBpCHOIw/ajkxNmAOKFFVMptWDoRNONviKeE1pYWzDWfAv3FdoIS2LcKrxnYmWnA7NbUwJfxy/RiJMF0KaTbrfQCsK1gX9KU4hmqFtcEscqxNNtqk8O9Xlcxahop4HabiqeGEjykAFeXij0QDoSzTzb37OLRznEE+6Q415RO6oXsU10aNmgqABT9qyrukKxkhoRcFzOjQlaU6r6KEZ1+ww3as6zDi3T/3GUSbH5R1/3WN49TcnYMiWx20IoK09d172GFbmaNtPgDpoT4ze3dObwBDbByKOktZ/eiAIlNClUuFey5kJaETE5TU8+/ro80SfjYpn3W71+XE7AhpbbkWr38TnDUnsnlxe4DdIG4roezl0we9pB4acsxrIZDmRX778t1qxLfX8B896tzMs5JRZ4U+euBgykvH9Fas0reK6jlqu+X8aSGZWyJme/UENMoHVqM4zN190xzpuOLhZ4DKqBIumBT8uRWRtYN3bYbhqpVHYLGP+/LlpbRj/aRVaAERztiZ1z9R7DRoM/3PHz2SAdNIx0mhzSsCgBBaO1ABfMsezeyyspAfqHpUc10lET4GIB52gQs8kJI4JQPw6zmdbWICfw5Cv97vBZoNT6KsVHiV70eLomzY97u8JGynomHlVUd4m8qT5H/hQMshYTNERDqfB/ERPOsyFwpdS2K/fNKkrD9QOqYDgvpiaLYEdmzyd/Mz6izbMvDMy+F+AEgtxaswemtOK2JnHPzNc62I9lrrNkYtSLFlq85S4NgnR3XBju2y54FyoO6cpygAhl/Ijyu53G3rPkyDRONiuQF/1ql8p5ZqBmf5D1t9KDFTpyQ8Z+JGw9HMwqNaHsj4EUx4gfNFnKJyvRLYPbfi8LrLA/irt5dMOa0HHDsLEkyrB5sR+ULqzN0uBsjjInHoHtidq7f4+8g8gmvnEI5rn1N0hrLayj380i87lcMRlByqJ3otbNyiaVXDjqSlTqHnjcHRIZUpGlZLy7mSvl1akY35+rlGO/n7ViOk4S+rciZVMpJ3bhMl/tJ6MEBGixpXbU2gCTqYbyxK7llUapLT6t763reaD2K8jQthm2nxHSNyspuLCLxM6ntVF5Y/5dYxK+0xeJ11VJT4IOTO/FsqLsmrJ8A9f10XidlVkiJ/uKRdFRd02dR90t6/LYhq8ZKFbdYKrGYzJoPHJWUO9XiDCMVEEl7wzv+8jKl4EIkqIHxbAO8j28YMEINGFwk9aYmsqpA+GiSxSeo354CgCVcXEXm83+T1zVILb9BK0J6xzUSdzSUgdU+/li98n7FiX14h0K+DQ6W8HHfFMDuhZjVjL0eW/ZLSIvECTwOhvlctX+21TE9UX5I9sYzc/5QCkQjPbxpgYecKS/unfCXuoBg8OEvxxRvwsHy3T4M+3QrXGIDbj54UR2KZb2gm8Ck5h1misHAmwmcc6bB7ODTCJ+jOporVYoUOUWJ5h7vWlCEu0laOYYJL7Ve742B9EJrh73S57CSFmi5n9DEPP+sJcSPcVVdQZfaxbv/fcoXazmnNVc1t8Og4BSY9lNiPPW1Z/ojsxQ11AKdjN8Uii3y6KQbwZ22yXW7mmzhiT7bLe5+pJp/keh7HTDIbO9kjgttylbHJH3ZdmM+SNiAtszB7/Qw4ldpHiPkQxNyiruuwe7P0GdamcSMSTbaW6k1hb+LuiIwQ8Gf5eGiR6sPC8HEMlGUUxsKaNUAQwb+j1pfZcLH4EfTZlUQdjNXwBz60uDjf3PPq2aApG5wX065pdoqipNcNUsUPD8vRkGKt2rkqmX9/WnTYRbYhFxQQzQV9x7EWBLH//fH76JfjZR6yr2qCrefUkc/mC5dV4mipmYY0XYDM9ZmSPkLh9GVMmjEJbja/j2SqcYv5Hq47+w12YhTs8nqmirMruV4OUUJwrHJGIeQ+nj7sGdIdMDmKN++b1rOWrZHNmRA/Oy9Ez8ml5N3Q3APTQODWUtlXodBDL6+JiggBx8T8eohfvAGFybHwKzVTTqthLJ/wuXlkwSwsH+RdxYWLUZ90VYTVqluhxWrBszcOGDkOLY9wOPZnorx613hC4D/ZxSH+ySPOBE4yEvdRoUumJNWU/8dRy7DT9SFjNCU5+s+kND3U47xaT8jiVoW7jMdIrXfw6d0BUlYH3xSIw9O75P0QmOzN3Sz78rR9K0ibXUZ3TMdZGENZDbOUlzWANxGvQQPyyKwcqGc/ufgTw+9ps84uIavy7V1+B6KDe94rZZwseR2R+fSHO1OhHlJd9krAb7Z6iasd5AtW2jI9b/qdkSxZbGuYEpljbPv+BLcsDc2qIDr7OK5RFKuIvPtIxWKEQRDFpDBjgsAqn5wVHvPxplCjvWtFUZcdg3tttEYs0qxDWgjg5chjfHYY3w6N/DOVAIb1r4EJcBeJm6BaobhVI/jXJsjcU8Kb36rPFWjwYhGr3XMK4mE7fBzsf8tZfbVM4oYQZ+s1Pd8xnsoEXqFtHhbHWGAxg10yfsxIPvr06gOfaKEjqAdB1wOF2ACbuXamMsGsnmIsGguOinrVzDY1Zb/vs2y6amMAf049hgdPbS2Vz2/uo8QftVHxqF/zYXJ5ECR0d9ZMHNjBrzIJm3eJT2kkbqHMnzW0GD5S1z7stTSwlku7tvxXDwYo1OLdU9Zhc78KU7aOlDKOaXVepYs+WFP3EHZ8oiPimmrmWxqSIvgvmtdx03wVzshhM2hRSbkCgn09vR0DI0DoaYXJ7jUyzU8Rf133vBu5fsrDiKIJDqLCKeH/A55esJSJKzSCAAAAAElFTkSuQmCC"],
          "brushTiltScale": 0,
          "brushTiltMinAngle": 0.25,
          "brushSize": 3.7,
          "minBrushSize": 2,
          "maxBrushSize": 50,
          "brushOpacity": 1,
          "brushBlur": 0,
          "minBrushBlur": 0,
          "maxBrushBlur": 1,
          "brushSpacing": 0.1,
          "pressureTextureCurvePoints": [[0,0],[1,0]],
          "pressureOpacityCurvePoints": [[0,1],[1,1]],
          "pressureScaleCurvePoints": [[0,0.33],[0.33,0.33],[1,1]],

          brushTipsImages: [],
          brushTexturesImages: [],
          pressureTextureCurve: pressure => {
            return uiSettings.toolsSettings.paint.modeSettings.all.pointCurve(
              pressure,
              uiSettings.toolsSettings.paint.modeSettings.all.pressureTextureCurvePoints
            )
          },
          pressureOpacityCurve: pressure => {
            return uiSettings.toolsSettings.paint.modeSettings.all.pointCurve(
              pressure,
              uiSettings.toolsSettings.paint.modeSettings.all.pressureOpacityCurvePoints
            )
          },
          pointCurve: ( input, points ) => {
            let i = 0;
            let pointBefore = points[ i ], pointAfter = points[ i+1 ];
            while( pointAfter[0] < input && (i+1) < points.length ) {
              i += 1;
              pointBefore = points[ i ];
              pointAfter = points[ i+1 ];
            }
            const dp = ( pointAfter[0] - input ) / ( pointAfter[0] - pointBefore[0] );
            const dpi = 1.0 - dp;
            const output = pointBefore[1]*dp + pointAfter[1]*dpi;
            return output;
          },
          //pressureScaleCurve: pressure => Math.max( 0.33, pressure ),
          pressureScaleCurve: pressure => {
            return uiSettings.toolsSettings.paint.modeSettings.all.pointCurve(
              pressure,
              uiSettings.toolsSettings.paint.modeSettings.all.pressureScaleCurvePoints
            )
          },

          /* brushTips: ["res/img/brushes/tip-pencil01.png"],
          brushTipsImages: [],
          brushTiltScale: 4,
          brushTiltMinAngle: 0.25, //~23 degrees
          brushSize: 14,
          minBrushSize: 2,
          maxBrushSize: 256,
          brushOpacity: 1,
          brushBlur: 0,
          minBrushBlur: 0,
          maxBrushBlur: 0.25,
          brushSpacing: 0.1,
          pressureOpacityCurve: pressure => pressure,
          pressureScaleCurve: pressure => 1, */
        },
        "brush": {
          colorMode: "hsl",
          colorModes: {
            hsl: {
              h:0, s:0.1, l:0.1,
              getColorStyle: () => {
                const {h,s,l} = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl;
                const [r,g,b] = hslToRgb( h,s,l );
                return `rgb(${r},${g},${b})`;
              },
              getRGB: () => {
                const {h,s,l} = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl;
                return hslToRgb( h,s,l );
              },
              getRGBFloat: () => {
                const {h,s,l} = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl;
                const [r,g,b] = hslToRgb( h,s,l );
                return [ r/255, g/255, b/255 ];
              }
            }
          },
        },
        "blend": {
          /* blendBlur: 0,
          reblendSpacing: 0.05,
          reblendAlpha: 0.1, */

          blendPull: 30,
          blendAlpha: 0, //blendAlpha is a mix ratio. 0=pure pigment, 1=pure blend
        },
        "erase": {
          eraseAmount: 0,
        }
      },
    },
    "mask": {
      maskColor: "rgb(255,255,255)", //might make configurable or change eventually, but not implemented yet
      maskRGBFloat: [1,1,1],
    },
    "transform": {
      current: true,
      transformingLayers: [],
    },
    "lasso": {
      shape: "free",
    },
    "flood-fill": {
      opacity: 1, //unimplemented
      tolerance: 0.1,
      padding: 0,
      erase: false, //false | true
      floodTarget: "area", //"area" | "color"
    },
    "pose": {
      moveChildren: true,
    }
  },

  defaultPoseRig: {
    "head": {
      "name": "head",
      "color": [255,0,0],
      "x": 0.521484375,
      "y": 0.146484375,
      "childLink": {
        "linkName": "head-to-crown-left",
        "childName": "crown-left",
        "color": [51,0,153]
      },
      "parentLink": {
        "linkName": "spine-to-head",
        "parentName": "spine",
        "color": [0,0,153]
      }
    },
    "spine": {
      "name": "spine",
      "color": [255,85,0],
      "x": 0.517578125,
      "y": 0.2578125,
      "childLink": {
        "linkName": "spine-to-shoulder-left",
        "childName": "shoulder-left",
        "color": [153,0,0]
      },
      "parentLink": null
    },
    "shoulder-left": {
      "name": "shoulder-left",
      "color": [255,170,0],
      "x": 0.447265625,
      "y": 0.259765625,
      "childLink": {
        "linkName": "shoulder-left-to-elbow-left",
        "childName": "elbow-left",
        "color": [153,102,0]
      },
      "parentLink": {
        "linkName": "spine-to-shoulder-left",
        "parentName": "spine",
        "color": [153,0,0]
      }
    },
    "elbow-left": {
      "name": "elbow-left",
      "color": [255,255,0],
      "x": 0.31640625,
      "y": 0.3203125,
      "childLink": {
        "linkName": "elbow-left-to-wrist-left",
        "childName": "wrist-left",
        "color": [153,153,0]
      },
      "parentLink": {
        "linkName": "shoulder-left-to-elbow-left",
        "parentName": "shoulder-left",
        "color": [153,102,0]
      }
    },
    "wrist-left": {
      "name": "wrist-left",
      "color": [170,255,0],
      "x": 0.19140625,
      "y": 0.333984375,
      "childLink": null,
      "parentLink": {
        "linkName": "elbow-left-to-wrist-left",
        "parentName": "elbow-left",
        "color": [153,153,0]
      }
    },
    "shoulder-right": {
      "name": "shoulder-right",
      "color": [85,255,0],
      "x": 0.58984375,
      "y": 0.259765625,
      "childLink": {
        "linkName": "shoulder-right-to-elbow-right",
        "childName": "elbow-right",
        "color": [102,153,0]
      },
      "parentLink": {
        "linkName": "spine-to-shoulder-right",
        "parentName": "spine",
        "color": [153,51,0]
      }
    },
    "elbow-right": {
      "name": "elbow-right",
      "color": [0,255,0],
      "x": 0.703125,
      "y": 0.322265625,
      "childLink": {
        "linkName": "elbow-right-to-wrist-right",
        "childName": "wrist-right",
        "color": [51,153,0]
      },
      "parentLink": {
        "linkName": "shoulder-right-to-elbow-right",
        "parentName": "shoulder-right",
        "color": [102,153,0]
      }
    },
    "wrist-right": {
      "name": "wrist-right",
      "color": [0,255,85],
      "x": 0.814453125,
      "y": 0.3359375,
      "childLink": null,
      "parentLink": {
        "linkName": "elbow-right-to-wrist-right",
        "parentName": "elbow-right",
        "color": [51,153,0]
      }
    },
    "hip-left": {
      "name": "hip-left",
      "color": [0,255,170],
      "x": 0.48046875,
      "y": 0.48828125,
      "childLink": {
        "linkName": "hip-left-to-knee-left",
        "childName": "knee-left",
        "color": [0,153,51]
      },
      "parentLink": {
        "linkName": "spine-to-hip-left",
        "parentName": "spine",
        "color": [0,153,0]
      }
    },
    "knee-left": {
      "name": "knee-left",
      "color": [0,255,255],
      "x": 0.47265625,
      "y": 0.69140625,
      "childLink": {
        "linkName": "knee-left-to-ankle-left",
        "childName": "ankle-left",
        "color": [0,153,102]
      },
      "parentLink": {
        "linkName": "hip-left-to-knee-left",
        "parentName": "hip-left",
        "color": [0,153,51]
      }
    },
    "ankle-left": {
      "name": "ankle-left",
      "color": [0,170,255],
      "x": 0.451171875,
      "y": 0.89453125,
      "childLink": null,
      "parentLink": {
        "linkName": "knee-left-to-ankle-left",
        "parentName": "knee-left",
        "color": [0,153,102]
      }
    },
    "hip-right": {
      "name": "hip-right",
      "color": [0,85,255],
      "x": 0.57421875,
      "y": 0.484375,
      "childLink": {
        "linkName": "hip-right-to-knee-right",
        "childName": "knee-right",
        "color": [0,102,153]
      },
      "parentLink": {
        "linkName": "spine-to-hip-right",
        "parentName": "spine",
        "color": [0,153,153]
      }
    },
    "knee-right": {
      "name": "knee-right",
      "color": [0,0,255],
      "x": 0.5703125,
      "y": 0.693359375,
      "childLink": {
        "linkName": "knee-right-to-ankle-right",
        "childName": "ankle-right",
        "color": [0,1,153]
      },
      "parentLink": {
        "linkName": "hip-right-to-knee-right",
        "parentName": "hip-right",
        "color": [0,102,153]
      }
    },
    "ankle-right": {
      "name": "ankle-right",
      "color": [85,0,255],
      "x": 0.576171875,
      "y": 0.896484375,
      "childLink": null,
      "parentLink": {
        "linkName": "knee-right-to-ankle-right",
        "parentName": "knee-right",
        "color": [0,1,153]
      }
    },
    "crown-left": {
      "name": "crown-left",
      "color": [170,0,255],
      "x": 0.498046875,
      "y": 0.123046875,
      "childLink": {
        "linkName": "crown-left-to-ear-left",
        "childName": "ear-left",
        "color": [102,0,153]
      },
      "parentLink": {
        "linkName": "head-to-crown-left",
        "parentName": "head",
        "color": [51,0,153]
      }
    },
    "crown-right": {
      "name": "crown-right",
      "color": [255,0,255],
      "x": 0.546875,
      "y": 0.125,
      "childLink": {
        "linkName": "crown-right-to-ear-right",
        "childName": "ear-right",
        "color": [153,0,102]
      },
      "parentLink": {
        "linkName": "head-to-crown-right",
        "parentName": "head",
        "color": [153,0,153]
      }
    },
    "ear-left": {
      "name": "ear-left",
      "color": [255,0,170],
      "x": 0.46484375,
      "y": 0.142578125,
      "childLink": null,
      "parentLink": {
        "linkName": "crown-left-to-ear-left",
        "parentName": "crown-left",
        "color": [102,0,153]
      }
    },
    "ear-right": {
      "name": "ear-right",
      "color": [255,0,85],
      "x": 0.578125,
      "y": 0.142578125,
      "childLink": null,
      "parentLink": {
        "linkName": "crown-right-to-ear-right",
        "parentName": "crown-right",
        "color": [153,0,102]
      }
    }
  }

}

const loadedBrushTipsImages = {};
function loadBrushTipsImages() {
  uiSettings.toolsSettings.paint.modeSettings.all.brushTipsImages.length = 0;
  uiSettings.toolsSettings.paint.modeSettings.all.brushTexturesImages.length = 0;
  for( const url of uiSettings.toolsSettings.paint.modeSettings.all.brushTips ) {
    if( loadedBrushTipsImages[ url ] )
      uiSettings.toolsSettings.paint.modeSettings.all.brushTipsImages.push( loadedBrushTipsImages[ url ] )
    else {
      const img = new Image();
      img.src = url;
      loadedBrushTipsImages[ url ] = img;
      uiSettings.toolsSettings.paint.modeSettings.all.brushTipsImages.push( img );
    }
  }
  for( const url of uiSettings.toolsSettings.paint.modeSettings.all.brushTextures ) {
    if( loadedBrushTipsImages[ url ] )
      uiSettings.toolsSettings.paint.modeSettings.all.brushTexturesImages.push( loadedBrushTipsImages[ url ] )
    else {
      const img = new Image();
      img.src = url;
      loadedBrushTipsImages[ url ] = img;
      uiSettings.toolsSettings.paint.modeSettings.all.brushTexturesImages.push( img );
    }
  }
}

loadBrushTipsImages();

function loadBrush( brush ) {
  //I need to overwrite brush settings
  //I'll remap here
  const { all, blend } = uiSettings.toolsSettings.paint.modeSettings;
  const brushKeysAll = [
    "brushTips", "brushTiltScale", "brushTiltMinAngle", "brushSize", "minBrushSize",
    "maxBrushSize", "brushOpacity", "brushBlur", "minBrushBlur", "maxBrushBlur", "brushSpacing",
    "pressureOpacityCurvePoints", "pressureScaleCurvePoints", "pressureTextureCurvePoints" ],
    brushKeysBlend = [
      "blendPull", "blendAlpha"
    ];
  for( const allKey of brushKeysAll )
    if( brush.hasOwnProperty( allKey ) ) {
      all[ allKey ] = brush[ allKey ];
    }
  for( const blendKey of brushKeysBlend )
    if( brush.hasOwnProperty( blendKey ) )
      blend[ blendKey ] = brush[ blendKey ];
  loadBrushTipsImages();
}

function setupUI() {
  
  //uiContainer is defined in HTML and grabbed at the top of this script.

  //the layers column
  {
    const layersColumn = document.createElement("div");
    layersColumn.classList.add( "animated" );
    layersColumn.id = "layers-column";
    layersColumn.layersHeight = -1;
    layersColumn.pixelHeight = -1;
    layersColumn.remHeight = -1;
    layersColumn.calculateHeight = () => {
      //first time height calculation (could have loaded file, this might not be zero)
      const remHeight = 1 + parseInt( layersColumn.layersHeight / 2 ) + 4 * layersColumn.layersHeight;
      layersColumn.remHeight = remHeight;
      layersColumn.style.height = remHeight + "rem";
      //get pixel height
      const pixelHeight = layersColumn.getClientRects()?.[ 0 ]?.height;
      if( pixelHeight ) layersColumn.pixelHeight = pixelHeight;
    }
    layersColumn.scrollToPosition = ( scrollPositionYPixels, bounce = false ) => {
      //make sure we have our real height
      const layersHeight = layersColumn.querySelectorAll( ".layer-button.expanded" ).length;
      //this doesn't account for inter-group spacings, but we'll count those separately
      //const groupSpacers = layersColumn.querySelectorAll( ".group-spacer.expanded" ).length;
      if( layersHeight !== layersColumn.layersHeight || layersColumn.pixelHeight === -1 ) {
        layersColumn.layersHeight = layersHeight;
        layersColumn.calculateHeight();
      }
      //get the maximum we can scroll to: top and bottom cannot exceed the 50% mark
      const screenHeight = window.innerHeight; //might need DPR
      const pixelsPerRem = layersColumn.pixelHeight / layersColumn.remHeight;

      const yLimit = screenHeight / 2,
        lowYLimit = yLimit - pixelsPerRem * 2.5,
        highYLimit = yLimit + pixelsPerRem * 2.5;

      if( scrollPositionYPixels > lowYLimit ) {
        let overBounce = 0;
        if( bounce === true ) {
          //how far over our limit are we?
          const overLimit = scrollPositionYPixels - lowYLimit;
          //at most the height of the screen
          const overLimitRatio = overLimit / screenHeight;
          //multiply that by 2rem to get our over-bounce
          overBounce = overLimitRatio * 4 * pixelsPerRem;
        }
        const scrollOffset = ( lowYLimit + overBounce );
        layersColumn.scrollOffset = scrollOffset;
        layersColumn.style.top = scrollOffset + "px";
      }

      else if( ( scrollPositionYPixels + layersColumn.pixelHeight ) < highYLimit ) {
        let overBounce = 0;
        if( bounce === true ) {
          //how far past our limit are we
          const overLimit = highYLimit - ( scrollPositionYPixels + layersColumn.pixelHeight );
          //as ratio of screen height
          const overLimitRatio = overLimit / screenHeight;
          //multiply that by 2rem to get over-bounce
          overBounce = overLimitRatio * 4 * pixelsPerRem;
        }
        const scrollOffset = ( highYLimit - layersColumn.pixelHeight - overBounce );
        layersColumn.scrollOffset = scrollOffset;
        layersColumn.style.top = scrollOffset + "px";
      }
      
      else {
        const scrollOffset = scrollPositionYPixels;
        layersColumn.scrollOffset = scrollOffset;
        layersColumn.style.top = scrollOffset + "px";
      }
    }
    layersColumn.scrollOffset = 0;
    uiContainer.appendChild( layersColumn );

    //layersColumn.scrollMomentum = 0;
    
    UI.registerElement( layersColumn, {
      updateContext: context => {
        if( context.has( "layers-visible" ) ) {
          layersColumn.classList.remove( "hidden" );
          layersColumn.classList.add( "animated" ); //just in case we missed end-timing while scrolling
          //compute height

          const layersHeight = layersColumn.querySelectorAll( ".layer-button.expanded" ).length;
          //this doesn't account for inter-group spacings, but we'll count those separately
          //const groupSpacers = layersColumn.querySelectorAll( ".group-spacer.expanded" ).length;
          
          if( layersHeight !== layersColumn.layersHeight || layersColumn.remHeight === -1 ) {
            layersColumn.layersHeight = layersHeight;
            layersColumn.calculateHeight();
            layersColumn.scrollOffset = window.innerHeight/2 - layersColumn.pixelHeight/2;
            layersColumn.scrollToPosition( layersColumn.scrollOffset );
          }
          //layersColumn.style.top = `calc( 50vh - ( ${columnHeight}rem / 2 ) )`; //+ ${scrollMomentum} + "px" );
        }
        else layersColumn.classList.add( "hidden" );
      }
    } )
  }
    
  //the tool column buttons
  {
    const toolsColumn = document.createElement( "div" );
    //classlist, don't forget overflow visible, vertical center on left, test on tablet size
    toolsColumn.id = "tools-column";
    uiContainer.appendChild( toolsColumn );

    //the generate button
    {
      const generateButton = document.createElement( "div" );
      generateButton.classList.add( "tools-column-generate-button", "round-toggle", "animated", "unavailable" );
      toolsColumn.appendChild( generateButton );
      const activateGenerativeTool = () => {
        const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
        //you can only one-click gen on paint layers, I guess? Hmm. I mean, I guess eventually we should be able to do vector->raster->gen->vector
        const nonUsableLayer = (selectedAndBatchedLayers.length!==1) || selectedAndBatchedLayers.some( l => l.layerType !== "generative" );

        if( ! generateButton.classList.contains( "unavailable" ) && ! nonUsableLayer ) {
          uiSettings.setActiveTool( "generate" );
          setupUIGenerativeControls( selectedLayer.generativeSettings.apiFlowName );
          document.querySelector( "#generative-controls-row" ).classList.remove( "hidden" );
        }
        else if( uiSettings.isActiveTool( "generate" ) ) uiSettings.unsetActiveTool( "generate" );
      }

      UI.registerElement(
        generateButton,
        {
          onclick: activateGenerativeTool,
          updateContext: () => {
            const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
            //you can only one-click gen on paint layers, I guess? Hmm. I mean, I guess eventually we should be able to do vector->raster->gen->vector
            const nonUsableLayer = (selectedAndBatchedLayers.length!==1) || selectedAndBatchedLayers.some( l => l.layerType !== "generative" );

            //if not generative layer selected, unavailable
            if( nonUsableLayer ) {
              generateButton.classList.add( "unavailable" );
              generateButton.querySelector(".tooltip" ).textContent = "AI Generation Tool [Select one generative layer to enable]";
              generateButton.classList.remove( "on" );
              if( uiSettings.isActiveTool( "generate" ) ) uiSettings.unsetActiveTool( "generate" );
            }
            //mark if available
            else {
              generateButton.classList.remove( "unavailable" );
              generateButton.querySelector(".tooltip" ).textContent = "AI Generation Tool";
            }

            if( uiSettings.isActiveTool( "generate" ) ) { generateButton.classList.add( "on" ); }
            else { generateButton.classList.remove( "on" ); }

          },
        },
        {
          tooltip: [ "AI Generation Tool", "to-right", "vertical-center" ],
          bindings: {
            "Activate Generative Tool": activateGenerativeTool
          }
        }
      )
    }

    //the AI tools button and panel
    {
      const aiToolsButton = document.createElement( "div" );
      aiToolsButton.classList.add( "tools-column-ai-tools-button", "round-toggle", "animated", "unavailable" );
      toolsColumn.appendChild( aiToolsButton );
      const openAIToolsPanel = () => {
        const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
        //you can only one-click gen on paint layers, I guess? Hmm. I mean, I guess eventually we should be able to do vector->raster->gen->vector
        const nonUsableLayer = (selectedAndBatchedLayers.length!==1) || selectedAndBatchedLayers.some( l => l.layerType !== "paint" );

        if( ! aiToolsButton.classList.contains( "unavailable" ) && ! nonUsableLayer ) {
          if( UI.context.has( "add-ai-tools-panel-visible" ) ) {
            UI.deleteContext( "add-ai-tools-panel-visible" );
          } else {
            UI.addContext( "add-ai-tools-panel-visible" );
          }
          aiToolsButton.classList.add( "pushed" );
          setTimeout( () => aiToolsButton.classList.remove( "pushed" ), UI.animationMS );
        }
      }

      UI.registerElement(
        aiToolsButton,
        {
          onclick: openAIToolsPanel,
          updateContext: () => {
            const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
            //you can only one-click gen on paint layers, I guess? Hmm. I mean, I guess eventually we should be able to do vector->raster->gen->vector
            const nonUsableLayer = (selectedAndBatchedLayers.length!==1) || selectedAndBatchedLayers.some( l => l.layerType !== "paint" );
    
            //if selectedlayer(s) contain non-paint, unavailable
            if( nonUsableLayer ) {
              aiToolsButton.classList.add( "unavailable" );
              aiToolsButton.classList.remove( "on" );
              aiToolsButton.querySelector( ".tooltip" ).textContent = "AI Tools [Select one paint layer to enable]";
              UI.deleteContext( "add-ai-tools-panel-visible" );
            } else {
              aiToolsButton.classList.remove( "unavailable" );
              aiToolsButton.querySelector( ".tooltip" ).textContent = "AI Tools";
              //if panel is visible, add "on"
              //if panel is not visible, remove "on"
              if( UI.context.has( "add-ai-tools-panel-visible" ) ) {
                aiToolsButton.classList.add( "on" );
              } else {
                aiToolsButton.classList.remove( "on" );
              }
            }
          },
        },
        {
          tooltip: [ "AI Tools", "to-right", "vertical-center" ],
          //Not sure this should have a key binding?
          //bindings: { "Open AI Tools Panel": openAIToolsPanel }
        }
      );
      
      //the AI tools hovering panel
      {
        const aiToolsPanel = document.createElement( "div" );
        aiToolsPanel.classList.add( "animated" );
        aiToolsPanel.id = "ai-tools-panel";
        aiToolsButton.appendChild( aiToolsPanel );

        //add the stylized summon marker arrow to the top-left
        const summonMarker = document.createElement( "div" );
        summonMarker.classList.add( "summon-marker" );
        aiToolsPanel.appendChild( summonMarker );

        UI.registerElement( aiToolsPanel, {
          onclickout: () => {
            UI.deleteContext( "add-ai-tools-panel-visible" );
          },
          updateContext: context => {
            if( context.has( "add-ai-tools-panel-visible" ) ) aiToolsPanel.classList.remove( "hidden" );
            else aiToolsPanel.classList.add( "hidden" );
          },
        }, { zIndex: 10000 } );

      }

    }

    //the paint button
    {
      const canvasToolsButton = document.createElement( "div" );
      canvasToolsButton.classList.add( "tools-column-paint-button", "round-toggle", "animated", "unavailable" );
      toolsColumn.appendChild( canvasToolsButton );
      const canvasTools = [ "paint", "mask", "lasso", "flood-fill", "color-adjust" ];
      const canvasLayerTypes = [ "paint", "generative", "text", "vector" ];
      let lastActiveCanvasTool = "paint";
      window.declareLastActiveTool = () => console.log( lastActiveCanvasTool );
      const activateCanvasToolsOptions = () => {
        const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
        //at least pose layers can't have masks IMO
        const nonUsableLayer = (selectedAndBatchedLayers.length===0) || selectedAndBatchedLayers.some( l => ! canvasLayerTypes.includes( l.layerType ) );
        const nonPaintLayer = (selectedAndBatchedLayers.length===0) || selectedAndBatchedLayers.some( l => l.layerType !== "paint" );
        const nonSinglePaintLayer = (selectedAndBatchedLayers.length!==1) || selectedAndBatchedLayers.some( l => l.layerType !== "paint" );

        if( ! canvasToolsButton.classList.contains( "unavailable" ) && ! nonUsableLayer ) {
          //this is a temporary fix to keep our tools on-screen; need to add color-adjust multiple layer support!
          if( nonSinglePaintLayer && ( uiSettings.isActiveTool( "color-adjust" ) || lastActiveCanvasTool === "color-adjust" ) ) {
            lastActiveCanvasTool = nonPaintLayer ? "mask" : "paint";
          }
          else if( nonPaintLayer ) lastActiveCanvasTool = "mask";
          uiSettings.setActiveTool( lastActiveCanvasTool );
        } else {
          canvasTools.forEach( t => uiSettings.isActiveTool( t ) ? uiSettings.unsetActiveTool( t ) : 0 );
          canvasToolsButton.classList.add( "unavailable" );
        }
      }
      UI.registerElement(
        canvasToolsButton,
        {
          onclick: activateCanvasToolsOptions,
          updateContext: () => {
            const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
            //at least pose layers can't have masks IMO
            const nonUsableLayer = (selectedAndBatchedLayers.length===0) || selectedAndBatchedLayers.some( l => ! canvasLayerTypes.includes( l.layerType ) );
    
            //if not paint layer selected, unavailable
            if( nonUsableLayer ) {
              canvasToolsButton.classList.add( "unavailable" );
              canvasToolsButton.querySelector(".tooltip" ).textContent = "Canvas Tools [Select only paint, generative, text, and vector layer(s) to enable]";
              canvasToolsButton.classList.remove( "on" );
              canvasTools.forEach( t => uiSettings.isActiveTool( t ) ? uiSettings.unsetActiveTool( t ) : 0 );
            } else {
              canvasToolsButton.classList.remove( "unavailable" );
              canvasToolsButton.querySelector(".tooltip" ).textContent = "Canvas Tools";
            }

            if( !nonUsableLayer && canvasTools.some( t => uiSettings.isActiveTool( t ) ) ) {
              canvasToolsButton.classList.add( "on" );
              lastActiveCanvasTool = canvasTools.find( t => uiSettings.isActiveTool( t ) );
            }
            else {
              canvasToolsButton.classList.remove( "on" );
            }

          },
        },
        {
          tooltip: [ "Canvas Tools", "to-right", "vertical-center" ],
          bindings: {
            "Activate Canvas Tools": activateCanvasToolsOptions,
          }
        }
      )
    }

    //the vector tool button
    {
      const vectorToolButton = document.createElement( "div" );
      vectorToolButton.classList.add( "tools-column-vector-button", "round-toggle", "animated", "unimplemented", "unavailable" );
      toolsColumn.appendChild( vectorToolButton );
      const activateVectorTool = () => {
        const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
        const nonVectorLayer = (selectedAndBatchedLayers.length===0) || selectedAndBatchedLayers.some( l => l.layerType !== "vector" );

        if( ! vectorToolButton.classList.contains( "unavailable" ) && ! nonVectorLayer ) {
          uiSettings.setActiveTool( "vector" )
        }
        else if( uiSettings.isActiveTool( "vector" ) ) uiSettings.unsetActiveTool( "vector" );
      }
      UI.registerElement(
        vectorToolButton,
        {
          onclick: activateVectorTool,
          updateContext: () => {
            const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
            const nonVectorLayer = (selectedAndBatchedLayers.length===0) || selectedAndBatchedLayers.some( l => l.layerType !== "vector" );
    
            if( vectorToolButton.classList.contains( "unimplemented" ) ) {
              vectorToolButton.classList.add( "unavailable" );
              vectorToolButton.classList.remove( "on" );
              vectorToolButton.querySelector(".tooltip" ).textContent = "!Unimplemented! Vector Tool" + ( nonVectorLayer ? "" : " [Select only vector layer(s) to enable]");
              if( uiSettings.isActiveTool( "vector" ) ) uiSettings.unsetActiveTool( "vector" );
              return;
            }
            //if no layer selected, unavailable
            if( nonVectorLayer ) {
              vectorToolButton.classList.add( "unavailable" );
              vectorToolButton.querySelector(".tooltip" ).textContent = "Vector Tool [Select only vector layer(s) to enable]";
              if( uiSettings.isActiveTool( "vector" ) ) uiSettings.unsetActiveTool( "vector" );
              vectorToolButton.classList.remove( "on" );
            } 
            if( selectedLayer?.layerType === "vector" ) {
              vectorToolButton.classList.remove( "unavailable" );
              vectorToolButton.querySelector(".tooltip" ).textContent = "Vector Tool";
              if( uiSettings.isActiveTool( "vector" ) ) vectorToolButton.classList.add( "on" );
              else vectorToolButton.classList.remove( "on" );
            }
          },
        },
        {
          tooltip: [ "Vector Tool", "to-right", "vertical-center" ],
          bindings: {
            "Activate Vector Tool": activateVectorTool,
          }
        }
      )
    }
    
    //the transform button
    {
      const transformButton = document.createElement( "div" );
      transformButton.classList.add( "tools-column-transform-button", "round-toggle", "animated", "unavailable" );
      toolsColumn.appendChild( transformButton );
      const activateTransformTool = () => {
        const selectedAndBatchedLayers = getSelectedOrBatchedLayers();

        if( ! transformButton.classList.contains( "unavailable" ) && selectedAndBatchedLayers.length > 0 ) {
          uiSettings.setActiveTool( "transform" );
        } else {
          transformButton.classList.add( "unavailable" );
          if( uiSettings.isActiveTool( "transform" ) ) uiSettings.unsetActiveTool( "transform" );
        }
      }
      UI.registerElement(
        transformButton,
        {
          onclick: activateTransformTool,
          updateContext: () => {
            const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
            //if no layer selected, unavailable
            //This tool AFAIK can be used on every layer type.
            if( uiSettings.activeTool === "transform" ) transformButton.classList.add( "on" );
            else transformButton.classList.remove( "on" );

            if( selectedAndBatchedLayers.length === 0 ) {
              transformButton.classList.add( "unavailable" );
              transformButton.querySelector(".tooltip" ).textContent = "Transform Tool [Select layer(s) to enable]";
              transformButton.classList.remove( "on" );
              if( uiSettings.isActiveTool( "transform" ) ) uiSettings.unsetActiveTool( "transform" );
            } else {
              transformButton.classList.remove( "unavailable" );
              transformButton.querySelector(".tooltip" ).textContent = "Transform Tool";
              if( uiSettings.isActiveTool( "transform" ) ) transformButton.classList.add( "on" );
              else transformButton.classList.remove( "on" );
            }
          },
        },
        {
          tooltip: [ "Transform Tool", "to-right", "vertical-center" ],
          bindings: {
            "Activate Transform Tool": activateTransformTool
          }
        }
      )
    }

    //the text tool button
    {
      const textToolButton = document.createElement( "div" );
      textToolButton.classList.add( "tools-column-text-tool-button", "round-toggle", "animated", "unimplemented", "unavailable" );
      toolsColumn.appendChild( textToolButton );
      const activateTextTool = () => {
        const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
        const nonTextLayer = (selectedAndBatchedLayers.length!==1) || selectedAndBatchedLayers.some( l => l.layerType !== "text" );

        if( ! textToolButton.classList.contains( "unavailable" ) && ! textToolButton.classList.contains( "unimplemented" ) && ! nonTextLayer ) {
          uiSettings.setActiveTool( "text" )
        }
      }
      UI.registerElement(
        textToolButton,
        {
          onclick: activateTextTool,
          updateContext: () => {

            const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
            const nonTextLayer = (selectedAndBatchedLayers.length!==1) || selectedAndBatchedLayers.some( l => l.layerType !== "text" );

            if( textToolButton.classList.contains( "unimplemented" ) ) {
              textToolButton.classList.add( "unavailable" );
              textToolButton.classList.remove( "on" );
              textToolButton.querySelector(".tooltip" ).textContent = "!Unimplemented! Text Tool" + (selectedLayer ? "" : " [Select one text layer to enable]");
              return;
            }
            //if no layer selected, unavailable
            if( nonTextLayer ) {
              textToolButton.classList.add( "unavailable" );
              textToolButton.querySelector(".tooltip" ).textContent = "Text Tool [Select one text layer to enable]";
              textToolButton.classList.remove( "on" );
              if( uiSettings.isActiveTool( "text" ) ) uiSettings.unsetActiveTool( "text" );
            } 
            else {
              textToolButton.classList.remove( "unavailable" );
              textToolButton.querySelector(".tooltip" ).textContent = "Text Tool";
              if( uiSettings.isActiveTool( "text") ) textToolButton.classList.add( "on" );
              else textToolButton.classList.remove( "on" );
            }
          },
        },
        {
          tooltip: [ "Flood Fill Tool", "to-right", "vertical-center" ],
          bindings: {
            "Activate Text Tool": activateTextTool
          }
        }
      )
    }
    
    //the pose tool button
    {
      const poseButton = document.createElement( "div" );
      poseButton.classList.add( "tools-column-pose-button", "round-toggle", "animated", "unavailable" );
      toolsColumn.appendChild( poseButton );
      const activatePoseTool = () => {
        const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
        const nonPoseLayer = (selectedAndBatchedLayers.length!==1) || selectedAndBatchedLayers.some( l => l.layerType !== "pose" );

        if( ! poseButton.classList.contains( "unavailable" ) && ! nonPoseLayer ) {
          uiSettings.setActiveTool( "pose" );
          document.querySelector( "#pose-rig-container" ).loadLayer( selectedLayer );
        } else {
          poseButton.classList.add( "unavailable" );
          if( uiSettings.activeTool === "pose" ) uiSettings.setActiveTool( null );
        }
      }
      UI.registerElement(
        poseButton,
        {
          onclick: activatePoseTool,
          updateContext: () => {
            const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
            const nonPoseLayer = (selectedAndBatchedLayers.length!==1) || selectedAndBatchedLayers.some( l => l.layerType !== "pose" );

            //if no layer selected, unavailable
            if( nonPoseLayer ) {
              poseButton.classList.add( "unavailable" );
              poseButton.querySelector(".tooltip" ).textContent = "Pose Tool [Select one pose layer to enable]";
              poseButton.classList.remove( "on" );
              if( uiSettings.activeTool === "pose" ) uiSettings.setActiveTool( null );
            }
            else {
              poseButton.classList.remove( "unavailable" );
              poseButton.querySelector(".tooltip" ).textContent = "Pose Tool";
              if( uiSettings.activeTool === "pose" ) poseButton.classList.add( "on" );
              else poseButton.classList.remove( "on" );
            }
          },
        },
        {
          tooltip: [ "Pose Tool", "to-right", "vertical-center" ],
          bindings: {
            "Activate Pose Tool": activatePoseTool
          }
        }
      )
    }

  }

  //the canvas tool options
  {
    const canvasControlsOptionsRow = document.createElement( "div" );
    canvasControlsOptionsRow.classList.add( "flex-row", "hidden", "animated" );
    canvasControlsOptionsRow.id = "paint-tools-options-row";
    uiContainer.appendChild( canvasControlsOptionsRow );
    UI.registerElement(
      canvasControlsOptionsRow,
      {
        updateContext: () => {
          if( [ "paint", "mask", "lasso", "flood-fill", "color-adjust" ].includes( uiSettings.activeTool ) ) {

            canvasControlsOptionsRow.classList.remove( "hidden" );

            /* const colorWell = document.querySelector( ".paint-tools-options-color-well" );
            if( [ "paint", "color-adjust" ].includes( uiSettings.activeTool ) )
              colorWell.classList.remove( "hidden" );
            else colorWell.classList.add( "hidden" ); */
          }
          else {
            canvasControlsOptionsRow.classList.add( "hidden" );
          }

        }
      },
      {
        zIndex: 1000,
      }
    );

    //the radio boxes controls toggles
    {
      //the paint-canvas controls button
      {
        const paintCanvasControlsButton = document.createElement( "div" );
        paintCanvasControlsButton.classList.add( "round-toggle", "on" );
        paintCanvasControlsButton.style.backgroundImage = "url('icon/canvas-paint.png')";
        const activatePaintCanvasControls = () => {
          const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
          const nonPaintLayer = (selectedAndBatchedLayers.length===0) || selectedAndBatchedLayers.some( l => l.layerType !== "paint" );

          if( ! paintCanvasControlsButton.classList.contains( "unavailable" ) && ! nonPaintLayer ) {
            uiSettings.setActiveTool( "paint" )
          } else {
            if( uiSettings.activeTool === "paint" ) uiSettings.setActiveTool( null );
            paintCanvasControlsButton.classList.add( "unavailable" );
          }
        }
        UI.registerElement(
          paintCanvasControlsButton,
          {
            onclick: activatePaintCanvasControls,
            updateContext: () => {

              const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
              const nonPaintLayer = (selectedAndBatchedLayers.length===0) || selectedAndBatchedLayers.some( l => l.layerType !== "paint" );

              if( nonPaintLayer && uiSettings.activeTool === "paint" ) {
                uiSettings.setActiveTool( null );
              }

              if( uiSettings.activeTool === "paint" ) { 
                paintCanvasControlsButton.classList.add( "on" ); 
              }
              else { 
                paintCanvasControlsButton.classList.remove( "on" ); 
              }
  
              //if not paint layer selected, unavailable
              if( nonPaintLayer ) {
                paintCanvasControlsButton.classList.add( "unavailable" );
                paintCanvasControlsButton.querySelector(".tooltip" ).textContent = "Canvas Paint [Select only paint layer(s) to enable]";
                paintCanvasControlsButton.classList.remove( "on" );
              } else {
                paintCanvasControlsButton.classList.remove( "unavailable" );
                paintCanvasControlsButton.querySelector(".tooltip" ).textContent = "Canvas Paint";
              }
            }
          },
          {
            tooltip: [ "Canvas Paint", "below", "to-right-of-center" ], zIndex:10000,
            bindings: {
              "Activate Canvas Controls - Paint": activatePaintCanvasControls
            }
          }
        );
        canvasControlsOptionsRow.appendChild( paintCanvasControlsButton );
      }
      //the mask-canvas controls button
      {
        const maskCanvasControlsButton = document.createElement( "div" );
        maskCanvasControlsButton.classList.add( "round-toggle", "on" );
        maskCanvasControlsButton.style.backgroundImage = "url('icon/gala-mask.png')";
        const activateMaskCanvasControls = () => {
          const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
          const nonMaskLayer = (selectedAndBatchedLayers.length===0) || selectedAndBatchedLayers.some( l => ! [ "paint", "generative", "text" ].includes( l.layerType ) );

          if( ! maskCanvasControlsButton.classList.contains( "unavailable" ) && ! nonMaskLayer ) {
            uiSettings.setActiveTool( "mask" )
          } else {
            if( uiSettings.activeTool === "mask" ) uiSettings.setActiveTool( null );
            maskCanvasControlsButton.classList.add( "unavailable" );
          }
        }
        UI.registerElement(
          maskCanvasControlsButton,
          {
            onclick: activateMaskCanvasControls,
            updateContext: () => {
              //if no layer selected, unavailable
              if( uiSettings.activeTool === "mask" ) maskCanvasControlsButton.classList.add( "on" );
              if( uiSettings.activeTool !== "mask" ) maskCanvasControlsButton.classList.remove( "on" );
              
              const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
              const nonMaskLayer = (selectedAndBatchedLayers.length===0) || selectedAndBatchedLayers.some( l => ! [ "paint", "generative", "text" ].includes( l.layerType ) );

              if( nonMaskLayer ) {
                maskCanvasControlsButton.classList.add( "unavailable" );
                maskCanvasControlsButton.querySelector(".tooltip" ).textContent = "Canvas Mask [Select only paint, text, or generative layer(s) to enable]";
                maskCanvasControlsButton.classList.remove( "on" );
              } else {
                maskCanvasControlsButton.classList.remove( "unavailable" );
                maskCanvasControlsButton.querySelector(".tooltip" ).textContent = "Canvas Mask";
                if( uiSettings.activeTool === "mask" ) maskCanvasControlsButton.classList.add( "on" );
                else maskCanvasControlsButton.classList.remove( "on" );
              }
            }
          },
          {
            tooltip: [ "Canvas Mask", "below", "to-right-of-center" ], zIndex:10000,
            bindings: {
              "Activate Canvas Controls - Mask": activateMaskCanvasControls
            }
          }
        );
        canvasControlsOptionsRow.appendChild( maskCanvasControlsButton );
      }
      //the lasso-canvas controls button
      {
        //we're keeping this under the canvas tools. those are the only ones that need it; because we'll have a unique transform? hmm.
        const lassoCanvasControlsButton = document.createElement( "div" );
        //lassoCanvasControlsButton.classList.add( "round-toggle", "on", "unimplemented", "unavailable" );
        lassoCanvasControlsButton.classList.add( "round-toggle", "on", "unavailable" );
        lassoCanvasControlsButton.style.backgroundImage = "url('icon/lasso-shape-free.png')";
        const activateLassoCanvasControls = () => {
          const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
          let nonPaintLayer = (selectedAndBatchedLayers.length === 0) || selectedAndBatchedLayers.some( l => l.layerType !== "paint" );
          if( ! lassoCanvasControlsButton.classList.contains( "unavailable" ) && ! lassoCanvasControlsButton.classList.contains( "unimplemented" ) && ! nonPaintLayer ) {
            uiSettings.setActiveTool( "lasso" )
          }
          else if( uiSettings.activeTool === "lasso" ) {
            uiSettings.setActiveTool( null );
          }
        }
        UI.registerElement(
          lassoCanvasControlsButton,
          {
            onclick: activateLassoCanvasControls,
            updateContext: () => {

              if( lassoCanvasControlsButton.classList.contains( "unimplemented" ) ) {
                lassoCanvasControlsButton.classList.add( "unavailable" );
                lassoCanvasControlsButton.classList.remove( "on" );
                return;
              }

              const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
              let nonPaintLayer = (selectedAndBatchedLayers.length === 0) || selectedAndBatchedLayers.some( l => l.layerType !== "paint" );
              //if no paint layer selected, unavailable
              if( nonPaintLayer ) {
                lassoCanvasControlsButton.classList.add( "unavailable" );
                lassoCanvasControlsButton.querySelector(".tooltip" ).textContent = "Canvas Lasso [Select only paint layer(s) to enable]";
                lassoCanvasControlsButton.classList.remove( "on" );
              }
              else {
                lassoCanvasControlsButton.classList.remove( "unavailable" );
                lassoCanvasControlsButton.querySelector(".tooltip" ).textContent = "Canvas Lasso";
                if( uiSettings.activeTool === "lasso" ) lassoCanvasControlsButton.classList.add( "on" );
                else lassoCanvasControlsButton.classList.remove( "on" );
              }
            }
          },
          {
            tooltip: [ "!Unimplemented! Canvas Lasso", "below", "to-right-of-center" ], zIndex:10000,
            bindings: {
              "Activate Canvas Controls - Lasso": activateLassoCanvasControls
            }
          }
        );
        canvasControlsOptionsRow.appendChild( lassoCanvasControlsButton );
      }
      //the flood-fill-canvas controls button
      {
        const floodFillCanvasControlsButton = document.createElement( "div" );
        floodFillCanvasControlsButton.classList.add( "round-toggle", "on" );
        floodFillCanvasControlsButton.style.backgroundImage = "url('icon/paint-bucket.png')";
        const activateFlooodFillCanvasControls = () => {
          const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
          const nonPaintLayer = (selectedAndBatchedLayers.length === 0) || selectedAndBatchedLayers.some( l => l.layerType !== "paint" );

          if( ! floodFillCanvasControlsButton.classList.contains( "unavailable" ) && ! nonPaintLayer ) {
            uiSettings.setActiveTool( "flood-fill" );
          } else {
            floodFillCanvasControlsButton.classList.add( "unavailable" );
          }
        }
        UI.registerElement(
          floodFillCanvasControlsButton,
          {
            onclick: activateFlooodFillCanvasControls,
            updateContext: () => {
              const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
              const nonPaintLayer = (selectedAndBatchedLayers.length === 0) || selectedAndBatchedLayers.some( l => l.layerType !== "paint" );

              //if no layer selected, unavailable
              if( nonPaintLayer ) {
                floodFillCanvasControlsButton.classList.add( "unavailable" );
                floodFillCanvasControlsButton.querySelector(".tooltip" ).textContent = "Canvas Flood Fill [Select only paint layer(s) to enable]";
                floodFillCanvasControlsButton.classList.remove( "on" );
              }
              else {
                floodFillCanvasControlsButton.classList.remove( "unavailable" );
                floodFillCanvasControlsButton.querySelector(".tooltip" ).textContent = "Canvas Flood Fill";
                if( uiSettings.isActiveTool( "flood-fill" ) ) {
                  floodFillCanvasControlsButton.classList.add( "on" );
                }
                else floodFillCanvasControlsButton.classList.remove( "on" );
              }
            }
          },
          {
            tooltip: [ "Canvas Flood Fill", "below", "to-right-of-center" ], zIndex:10000,
            bindings: {
              "Activate Canvas Controls - Flood Fill": activateFlooodFillCanvasControls
            }
          }
        );
        canvasControlsOptionsRow.appendChild( floodFillCanvasControlsButton );
      }
      //the color-adjust-canvas controls button
      {
        const colorAdjustCanvasControlsButton = document.createElement( "div" );
        colorAdjustCanvasControlsButton.classList.add( "round-toggle", "on" );
        colorAdjustCanvasControlsButton.style.backgroundImage = "url('icon/adjust.png')";
        const activateColorAdjustCanvasControls = () => {
          const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
          let nonPaintLayer = (selectedAndBatchedLayers.length !== 1) || selectedAndBatchedLayers.some( l => l.layerType !== "paint" );
          if( ! colorAdjustCanvasControlsButton.classList.contains( "unavailable" ) && ! nonPaintLayer ) {
            uiSettings.setActiveTool( "color-adjust" );
          } else {
            colorAdjustCanvasControlsButton.classList.add( "unavailable" );
            if( uiSettings.isActiveTool( "color-adjust" ) ) uiSettings.unsetActiveTool( "color-adjust" );
          }
        }
        console.error( "TODO IMMEDIATELY!: modify color adjust to accept multiple layers (w/ GPU shader preview & resolution i guess probably)" );
        UI.registerElement(
          colorAdjustCanvasControlsButton,
          {
            onclick: activateColorAdjustCanvasControls,
            updateContext: () => {
              const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
              let nonPaintLayer = (selectedAndBatchedLayers.length !== 1 ) || selectedAndBatchedLayers.some( l => l.layerType !== "paint" );
              //if no layer selected, unavailable
              if( nonPaintLayer ) {
                colorAdjustCanvasControlsButton.classList.add( "unavailable" );
                colorAdjustCanvasControlsButton.querySelector(".tooltip" ).textContent = "Canvas Color Adjust [Select one paint layer to enable]";
                colorAdjustCanvasControlsButton.classList.remove( "on" );
              }
              else {
                colorAdjustCanvasControlsButton.classList.remove( "unavailable" );
                colorAdjustCanvasControlsButton.querySelector(".tooltip" ).textContent = "Canvas Color Adjust";
                if( uiSettings.isActiveTool( "color-adjust" ) ) colorAdjustCanvasControlsButton.classList.add( "on" );
                else colorAdjustCanvasControlsButton.classList.remove( "on" );
              }
            }
          },
          {
            tooltip: [ "Canvas Color Adjust", "below", "to-right-of-center" ], zIndex:10000,
            bindings: {
              "Activate Canvas Controls - Color Adjust": activateColorAdjustCanvasControls
            }
          }
        );
        canvasControlsOptionsRow.appendChild( colorAdjustCanvasControlsButton );
      }
    }

    //a vertical spacer divider
    {
      const verticalSpacer = document.createElement( "div" );
      verticalSpacer.classList.add( "vertical-spacer" );
      canvasControlsOptionsRow.appendChild( verticalSpacer );
    }

    //the tool options row
    {
      const toolOptionsRow = document.createElement( "div" );
      toolOptionsRow.classList.add( "tool-options-container", "flex-row" );
      canvasControlsOptionsRow.appendChild( toolOptionsRow );

      //the paint and mask tool options
      {
        const paintAndMaskOptionsRow = document.createElement( "div" );
        paintAndMaskOptionsRow.classList.add( "flex-row", "animated" );
        paintAndMaskOptionsRow.id = "paint-mask-options-row";
        toolOptionsRow.appendChild( paintAndMaskOptionsRow );
        UI.registerElement(
          paintAndMaskOptionsRow,
          {
            updateContext: () => {
              if( [ "paint", "mask" ].includes( uiSettings.activeTool ) ) {
                paintAndMaskOptionsRow.classList.remove( "hidden" );
              }
              else { paintAndMaskOptionsRow.classList.add( "hidden" ); }
            }
          }
        );
  
  
        //the brush select (asset browser) button
        {
          const brushSelectBrowseButton = document.createElement( "div" );
          //brushSelectBrowseButton.classList.add( "asset-browser-button" );
          brushSelectBrowseButton.classList.add( "paint-tools-options-brushes-button", "round-toggle", "on" );
          const changeBrush = () => {
            openAssetBrowser( assetsLibrary.Brushes, brush => loadBrush( brush ), "Brushes" );
          }
          UI.registerElement(
            brushSelectBrowseButton,
            { onclick: changeBrush },
            {
              tooltip: [ "Select Brush", "below", "to-right-of-center" ], zIndex:10000,
              bindings: { "Change Brush": changeBrush }
            }
          );
          paintAndMaskOptionsRow.appendChild( brushSelectBrowseButton );
        }
      
        //the paint button
        {
          const paintModeButton = document.createElement( "div" );
          //brushSelectBrowseButton.classList.add( "asset-browser-button" );
          paintModeButton.classList.add( "paint-tools-options-paint-mode", "round-toggle", "on" );
          const activatePaintModePaint = () => {
            uiSettings.toolsSettings.paint.setMode( "brush" );
            uiSettings.toolsSettings.paint.modeSettings.erase.eraseAmount = 0;
            uiSettings.toolsSettings.paint.modeSettings.blend.blendAlpha = 0;
            UI.updateContext();
          }
          UI.registerElement(
            paintModeButton,
            {
              onclick: activatePaintModePaint,
              updateContext: () => {
                if( uiSettings.toolsSettings.paint.modeSettings.erase.eraseAmount === 0 && 
                    uiSettings.toolsSettings.paint.modeSettings.blend.blendAlpha === 0 )
                  paintModeButton.classList.add( "on" );
                else paintModeButton.classList.remove( "on" );
              }
            },
            {
              tooltip: [ "Paint Mode", "below", "to-right-of-center" ], zIndex:10000,
              bindings: {
                "Set Paint Mode - Paint": activatePaintModePaint
              }
            }
          );
          paintAndMaskOptionsRow.appendChild( paintModeButton );
        }
        //the blend button
        {
          const blendMode = document.createElement( "div" );
          //brushSelectBrowseButton.classList.add( "asset-browser-button" );
          blendMode.classList.add( "paint-tools-options-blend-mode", "round-toggle", "on" );
          const activatePaintModeBlend = () => {
            //uiSettings.toolsSettings.paint.setMode( "blend" );
            uiSettings.toolsSettings.paint.setMode( "brush" );
            uiSettings.toolsSettings.paint.modeSettings.erase.eraseAmount = 0;
            uiSettings.toolsSettings.paint.modeSettings.blend.blendAlpha = 1;
            UI.updateContext();
          }
          UI.registerElement(
            blendMode,
            {
              onclick: activatePaintModeBlend,
              updateContext: () => {
                if( uiSettings.toolsSettings.paint.modeSettings.erase.eraseAmount === 0 && 
                    uiSettings.toolsSettings.paint.modeSettings.blend.blendAlpha === 1 )
                  blendMode.classList.add( "on" );
                else blendMode.classList.remove( "on" );
              }
            },
            {
              tooltip: [ "Blend Mode", "below", "to-right-of-center" ], zIndex:10000,
              bindings: {
                "Set Paint Mode - Blend": activatePaintModeBlend
              }
            }
          );
          paintAndMaskOptionsRow.appendChild( blendMode );
        }
        //the erase button
        {
          const eraseMode = document.createElement( "div" );
          //brushSelectBrowseButton.classList.add( "asset-browser-button" );
          eraseMode.classList.add( "paint-tools-options-erase-mode", "round-toggle", "on" );
          const activatePaintModeErase = () => {
            //uiSettings.toolsSettings.paint.setMode( "erase" );
            uiSettings.toolsSettings.paint.setMode( "brush" );
            uiSettings.toolsSettings.paint.modeSettings.erase.eraseAmount = 1;
            uiSettings.toolsSettings.paint.modeSettings.blend.blendAlpha = 0;
            UI.updateContext();
          }
          UI.registerElement(
            eraseMode,
            {
              onclick: activatePaintModeErase,
              updateContext: () => {
                if( uiSettings.toolsSettings.paint.modeSettings.erase.eraseAmount === 1 && 
                    uiSettings.toolsSettings.paint.modeSettings.blend.blendAlpha === 0 )
                  eraseMode.classList.add( "on" );
                else eraseMode.classList.remove( "on" );
              }
            },
            {
              tooltip: [ "Erase Mode", "below", "to-right-of-center" ], zIndex:10000,
              bindings: {
                "Set Paint Mode - Erase": activatePaintModeErase
              }
            }
          );
          paintAndMaskOptionsRow.appendChild( eraseMode );
        }
        //the retractable size slider
        {
          const retractableSizeSlider = document.createElement( "div" );
          retractableSizeSlider.classList.add( "paint-tools-options-retractable-slider", "animated" );
          const previewCore = retractableSizeSlider.appendChild( document.createElement( "div" ) );
          previewCore.classList.add( "paint-tools-options-brush-size-preview-core" );
          const previewNumber = retractableSizeSlider.appendChild( document.createElement( "div" ) );
          previewNumber.classList.add( "paint-tools-options-preview-number", "animated" );
          previewNumber.style.opacity = 0;
          //TODO size preview?
          const updateBrushSizePreview = ( brushSize = null ) => {
            retractableSizeSlider.classList.remove( "hovering" );
            const settings = uiSettings.toolsSettings.paint.modeSettings.all;
            if( ! brushSize ) {
              brushSize = settings.brushSize;
            }
            //update preview number
            let number = (parseInt( brushSize * 10 ) / 10).toString();
            if( number.indexOf( "." ) === -1 ) number += ".0";
            previewNumber.textContent = number + "px";
            //get size percentage
            const percent = parseInt( 100 * ( brushSize - settings.minBrushSize ) / ( settings.maxBrushSize - settings.minBrushSize ) );
            previewCore.style.width = percent + "%";
            previewCore.style.height = percent + "%";
          }
    
          let adjustBrushSizePreviewNotificationTimer;
          const adjustBrushSize = scaleFactor => {
            const settings = uiSettings.toolsSettings.paint.modeSettings.all;
            const range = ( settings.maxBrushSize - settings.minBrushSize );
            let brushSize = settings.brushSize;
            brushSize += scaleFactor * range;
            brushSize = Math.max( settings.minBrushSize, Math.min( settings.maxBrushSize, brushSize ) );
            settings.brushSize = parseInt( brushSize );
            updateBrushSizePreview( brushSize );
            previewNumber.style.opacity = 1;
            clearTimeout( adjustBrushSizePreviewNotificationTimer );
            adjustBrushSizePreviewNotificationTimer = setTimeout( ()=>previewNumber.style.opacity = 0, UI.animationMS * 3 );
          }
          updateBrushSizePreview();
          let startingBrushSize,
            adjustmentScale;
          UI.registerElement(
            retractableSizeSlider,
            {
              ondrag: ({ rect, start, current, ending, starting, element }) => {
                const settings = uiSettings.toolsSettings.paint.modeSettings.all;
                if( starting ) {
                  previewNumber.style.opacity = 1;
                  retractableSizeSlider.querySelector( ".tooltip" ).style.opacity = 0;
                  startingBrushSize = settings.brushSize;
                  adjustmentScale = ( settings.maxBrushSize - settings.minBrushSize ) / 300; //300 pixel screen-traverse
                }
                const dx =  current.x - start.x;
                const adjustment = dx * adjustmentScale;
                let brushSize = startingBrushSize + adjustment;
                brushSize = Math.max( settings.minBrushSize, Math.min( settings.maxBrushSize, brushSize ) );
                settings.brushSize = parseInt( brushSize );
                updateBrushSizePreview( brushSize );
                if( ending ) {
                  previewNumber.style.opacity = 0;
                  retractableSizeSlider.querySelector( ".tooltip" ).style = "";
                }
              },
              updateContext: () => updateBrushSizePreview()
            },
            {
              tooltip: [ '<img src="icon/arrow-left.png"> Drag to Adjust Brush Size <img src="icon/arrow-right.png">', "below", "to-right-of-center" ], zIndex:10000,
              bindings: {
                "Increase Brush Size": () => {
                  adjustBrushSize( 0.05 );
                },
                "Decrease Brush Size": () => {
                  adjustBrushSize( -0.05 );
                }
              }
            }
          );
          paintAndMaskOptionsRow.appendChild( retractableSizeSlider );
        }
        //the retractable softness slider
        {
          const retractableSoftnessSlider = document.createElement( "div" );
          retractableSoftnessSlider.classList.add( "paint-tools-options-retractable-slider", "animated" );
          const previewCore = retractableSoftnessSlider.appendChild( document.createElement( "div" ) );
          previewCore.classList.add( "paint-tools-options-brush-softness-preview-core" );
          const previewNumber = retractableSoftnessSlider.appendChild( document.createElement( "div" ) );
          previewNumber.classList.add( "paint-tools-options-preview-number", "animated" );
          previewNumber.style.opacity = 0;
          //TODO size preview?
          const updateBrushSoftnessPreview = ( brushSoftness = null ) => {
            retractableSoftnessSlider.classList.remove( "hovering" );
            const settings = uiSettings.toolsSettings.paint.modeSettings.all;
            if( ! brushSoftness ) {
              brushSoftness = settings.brushBlur;
            }
            //get size percentage
            const rate = ( brushSoftness - settings.minBrushBlur ) / ( settings.maxBrushBlur - settings.minBrushBlur );
            const percent = parseInt( 100 * rate );
            //update preview number
            previewNumber.textContent = percent + "%";
            //update preview
            previewCore.style.filter = "blur( " + rate*0.5 + "rem )";
          }
          updateBrushSoftnessPreview();
          let startingBrushSoftness,
            adjustmentScale;
          UI.registerElement(
            retractableSoftnessSlider,
            {
              ondrag: ({ rect, start, current, ending, starting, element }) => {
                const settings = uiSettings.toolsSettings.paint.modeSettings.all;
                if( starting ) {
                  previewNumber.style.opacity = 1;
                  retractableSoftnessSlider.querySelector( ".tooltip" ).style.opacity = 0;
                  startingBrushSoftness = settings.brushBlur;
                  adjustmentScale = ( settings.maxBrushBlur - settings.minBrushBlur ) / 300; //300 pixel screen-traverse
                }
                const dx =  current.x - start.x;
                const adjustment = dx * adjustmentScale;
                let brushSoftness = startingBrushSoftness + adjustment;
                brushSoftness = Math.max( settings.minBrushBlur, Math.min( settings.maxBrushBlur, brushSoftness ) );
                settings.brushBlur = brushSoftness;
                updateBrushSoftnessPreview( brushSoftness );
                if( ending ) {
                  previewNumber.style.opacity = 0;
                  retractableSoftnessSlider.querySelector( ".tooltip" ).style = "";
                }
              },
              updateContext: () => updateBrushSoftnessPreview()
            },
            { tooltip: [ '<img src="icon/arrow-left.png"> Drag to Adjust Brush Softness <img src="icon/arrow-right.png">', "below", "to-right-of-center" ], zIndex:10000, }
          );
          paintAndMaskOptionsRow.appendChild( retractableSoftnessSlider );
        }
        //the retractable opacity slider
        {
          const retractableOpacitySlider = document.createElement( "div" );
          retractableOpacitySlider.classList.add( "paint-tools-options-retractable-slider", "paint-tools-options-retractable-opacity-slider", "animated" );
          const previewCore = retractableOpacitySlider.appendChild( document.createElement( "div" ) );
          previewCore.classList.add( "paint-tools-options-brush-opacity-preview-core" );
          const previewNumber = retractableOpacitySlider.appendChild( document.createElement( "div" ) );
          previewNumber.classList.add( "paint-tools-options-preview-number", "animated" );
          previewNumber.style.opacity = 0;
          //TODO size preview?
          const updateBrushOpacityPreview = ( brushOpacity = null ) => {
            retractableOpacitySlider.classList.remove( "hovering" );
            const settings = uiSettings.toolsSettings.paint.modeSettings.all;
            if( ! brushOpacity ) {
              brushOpacity = settings.brushOpacity;
            }
            //update preview number
            let number = (parseInt( brushOpacity * 10 ) / 10).toString();
            if( number.indexOf( "." ) === -1 ) number += ".0";
            //get size percentage
            const rate = brushOpacity;
            const percent = parseInt( 100 * rate );
            previewNumber.textContent = percent + "%";
            previewCore.style.opacity = rate;
          }
          updateBrushOpacityPreview();
          let startingBrushOpacity,
            adjustmentScale;
          UI.registerElement(
            retractableOpacitySlider,
            {
              ondrag: ({ rect, start, current, ending, starting, element }) => {
                const settings = uiSettings.toolsSettings.paint.modeSettings.all;
                if( starting ) {
                  previewNumber.style.opacity = 1;
                  retractableOpacitySlider.querySelector( ".tooltip" ).style.opacity = 0;
                  startingBrushOpacity = settings.brushOpacity;
                  adjustmentScale = 1 / 300; //300 pixel screen-traverse
                }
                const dx =  current.x - start.x;
                const adjustment = dx * adjustmentScale;
                let brushOpacity = startingBrushOpacity + adjustment;
                brushOpacity = Math.max( 0, Math.min( 1, brushOpacity ) );
                settings.brushOpacity = brushOpacity;
                updateBrushOpacityPreview( brushOpacity );
                if( ending ) {
                  previewNumber.style.opacity = 0;
                  retractableOpacitySlider.querySelector( ".tooltip" ).style = "";
                }
              },
              updateContext: () => updateBrushOpacityPreview()
            },
            { tooltip: [ '<img src="icon/arrow-left.png"> Drag to Adjust Brush Opacity <img src="icon/arrow-right.png">', "below", "to-right-of-center" ], zIndex:10000, }
          );
          paintAndMaskOptionsRow.appendChild( retractableOpacitySlider );
        }
    
        //the retractable blend amount slider
        if( false ){
          const retractableBlendnessSlider = document.createElement( "div" );
          retractableBlendnessSlider.classList.add( "paint-tools-options-retractable-slider", "paint-tools-options-retractable-blendness-slider", "animated" );
          /* const previewCore = retractableBlendnessSlider.appendChild( document.createElement( "div" ) );
          previewCore.classList.add( "paint-tools-options-brush-blendness-preview-core" ); */
          const previewNumberBlend = retractableBlendnessSlider.appendChild( document.createElement( "div" ) );
          previewNumberBlend.classList.add( "paint-tools-options-preview-number", "animated" );
          previewNumberBlend.style.opacity = 0;
          
          const updateBrushBlendnessPreview = ( brushBlendness = null ) => {
            retractableBlendnessSlider.classList.remove( "hovering" );
            const settings = uiSettings.toolsSettings.paint.modeSettings;
            if( ! brushBlendness ) {
              brushBlendness = settings.blend.blendAlpha;
            }
            //update preview number
            let number = (parseInt( brushBlendness * 10 ) / 10).toString();
            if( number.indexOf( "." ) === -1 ) number += ".0";
            //get size percentage
            const rate = brushBlendness;
            const percent = parseInt( 100 * rate );
            previewNumberBlend.textContent = percent + "%";
            //previewCore.style.opacity = rate;
          }
          updateBrushBlendnessPreview();
          let startingBrushBlendness,
            adjustmentScale;
          UI.registerElement(
            retractableBlendnessSlider,
            {
              ondrag: ({ rect, start, current, ending, starting, element }) => {
                const settings = uiSettings.toolsSettings.paint.modeSettings.blend;
                if( starting ) {
                  previewNumberBlend.style.opacity = 1;
                  retractableBlendnessSlider.querySelector( ".tooltip" ).style.opacity = 0;
                  startingBrushBlendness = settings.blendAlpha;
                  adjustmentScale = 1 / 300; //300 pixel screen-traverse
                }
                const dx =  current.x - start.x;
                const adjustment = dx * adjustmentScale;
                let brushBlendness = startingBrushBlendness + adjustment;
                brushBlendness = Math.max( 0, Math.min( 1, brushBlendness ) );
                settings.blendAlpha = brushBlendness;
                updateBrushBlendnessPreview( brushBlendness );
                if( ending ) {
                  previewNumberBlend.style.opacity = 0;
                  retractableBlendnessSlider.querySelector( ".tooltip" ).style = "";
                }
              },
              updateContext: () => updateBrushBlendnessPreview()
            },
            { tooltip: [ '<img src="icon/arrow-left.png"> Drag to Adjust Blend Amount <img src="icon/arrow-right.png">', "below", "to-right-of-center" ], zIndex:10000, }
          );
          paintAndMaskOptionsRow.appendChild( retractableBlendnessSlider );
        }
    
      }
      
      //the color adjust tool options
      {
        const colorAdjustToolOptionsRow = document.createElement( "div" );
        colorAdjustToolOptionsRow.classList.add( "flex-row", "hidden", "animated" );
        colorAdjustToolOptionsRow.id = "color-adjust-tools-options-row";
        toolOptionsRow.appendChild( colorAdjustToolOptionsRow );
        let adjustingLayer = null,
          lassoLayer = null,
          sourceCanvas = document.createElement( "canvas" ),
          sourceContext = sourceCanvas.getContext( "2d" ),
          colorAdjustments = {
            saturation: 0, //0=unsaturated, 1=no effect, >1 saturate
            contrast: 0, //0=gray, 1=no effect, >1 contrast
            brightness: 0, //0=black, 1=no effect, >1 brighten
            hue: 0, //degrees or turns, 0=no effect
            invert: 0, //0=no effect, 1=invert
          };
        UI.registerElement(
          toolOptionsRow,
          {
            updateContext: () => {
              if( uiSettings.isActiveTool( "color-adjust" ) && selectedLayer && selectedLayer.layerType === "paint" ) {
                if( adjustingLayer !== selectedLayer ) {
                  if( adjustingLayer !== null ) {
                    //this is weird behavior (not a code bug, just a user-expectations questions)
                    //e.g., if you preview, then merge down, then undo... what happens? is it reasonable?
                    resetPreview();
                    adjustingLayer = null;
                  }
                  colorAdjustToolOptionsRow.classList.remove( "hidden" );
                  adjustingLayer = selectedLayer;
                  loadSourceCanvasFromLayer( adjustingLayer );
                  Object.keys( colorAdjustments ).forEach( k => colorAdjustments[ k ] = 0 );
                }
              }
              else {
                if( adjustingLayer !== null ) {
                  //roll back any changes if any filter is non-zero
                  resetPreview();
                  adjustingLayer = null;
                }
                if( uiSettings.activeTool === "color-adjust" ) {
                  uiSettings.setActiveTool( null );
                  adjustingLayer = null;
                }
                colorAdjustToolOptionsRow.classList.add( "hidden" );
              }
            }
          },
          {
            zIndex: 1000,
          }
        );
  
        function loadSourceCanvasFromLayer( layer ) {
          adjustingLayer = layer;
          sourceCanvas.width = layer.w;
          sourceCanvas.height = layer.h;
          sourceContext.clearRect( 0,0,layer.w,layer.h );
          sourceContext.save();
          sourceContext.globalCompositeOperation = "copy";
          sourceContext.globalAlpha = 1.0;
          sourceContext.drawImage( layer.canvas, 0, 0 );
          sourceContext.restore();
          lassoLayer = getLassoLayerForLayer( layer, true );
          if( lassoLayer ) {
            lassoLayer.context.putImageData( lassoLayer.lassoImageData, 0, 0 );
          }
        }
  
        function resetPreview() {
          Object.keys( colorAdjustments ).forEach( k => colorAdjustments[ k ] = 0 );
          colorAdjustToolOptionsRow.querySelectorAll( ".number-slider" ).forEach( s => s.setValue( 0 ) );
          adjustingLayer.context.save();
          adjustingLayer.context.filter = "none";
          adjustingLayer.context.globalCompositeOperation = "copy";
          adjustingLayer.context.globalAlpha = 1.0;
          adjustingLayer.context.drawImage( sourceCanvas, 0, 0 );
          adjustingLayer.context.restore();
          flagLayerTextureChanged( adjustingLayer, null, false );
        }
        function updateColorAdjustPreview() {
          adjustingLayer.context.save();
          if( lassoLayer ) {
            adjustingLayer.context.filter = "none";
            adjustingLayer.context.globalCompositeOperation = "copy";
            adjustingLayer.context.globalAlpha = 1.0;
            adjustingLayer.context.drawImage( sourceCanvas, 0, 0 );
            if( lassoResources.invert === false ) adjustingLayer.context.globalCompositeOperation = "destination-out";
            else adjustingLayer.context.globalCompositeOperation = "destination-in";
            adjustingLayer.context.drawImage( lassoLayer.canvas, 0, 0 );
          }
          adjustingLayer.context.filter = `saturate(${colorAdjustments.saturation+1}) contrast(${colorAdjustments.contrast+1}) brightness(${colorAdjustments.brightness+1}) hue-rotate(${colorAdjustments.hue}turn) invert(${colorAdjustments.invert})`;
          if( lassoLayer ) adjustingLayer.context.globalCompositeOperation = "destination-over";
          else adjustingLayer.context.globalCompositeOperation = "copy";
          adjustingLayer.context.globalAlpha = 1.0;
          adjustingLayer.context.drawImage( sourceCanvas, 0, 0 );
          adjustingLayer.context.restore();
          flagLayerTextureChanged( adjustingLayer, null, false );
        }
        function finalizeColorAdjust() {
  
          updateColorAdjustPreview();
          const sourceURL = sourceCanvas.toDataURL();
          const finalURL = adjustingLayer.canvas.toDataURL();
          flagLayerTextureChanged( adjustingLayer, null, true );
          
          Object.keys( colorAdjustments ).forEach( k => colorAdjustments[ k ] = 0 );
          colorAdjustToolOptionsRow.querySelectorAll( ".number-slider" ).forEach( s => s.setValue( 0 ) );
  
          //add undo record
          const oldImg = new Image(),
            newImg = new Image();
          oldImg.src = sourceURL;
          newImg.src = finalURL;
  
          const historyEntry = {
            targetLayer: adjustingLayer,
            oldImg,
            newImg,
            undo: () => {
              historyEntry.targetLayer.context.save();
              historyEntry.targetLayer.context.globalCompositeOperation = "copy";
              historyEntry.targetLayer.context.globalAlpha = 1.0;
              //while it is technically possible to miss timing here, it's probably nbd
              historyEntry.targetLayer.context.drawImage( historyEntry.oldImg, 0, 0 );
              historyEntry.targetLayer.context.restore();
              flagLayerTextureChanged( historyEntry.targetLayer, null, true );
            },
            redo: () => {
              historyEntry.targetLayer.context.save();
              historyEntry.targetLayer.context.globalCompositeOperation = "copy";
              historyEntry.targetLayer.context.globalAlpha = 1.0;
              historyEntry.targetLayer.context.drawImage( historyEntry.newImg, 0, 0 );
              historyEntry.targetLayer.context.restore();
              flagLayerTextureChanged( historyEntry.targetLayer, null, true );
            },
          };
          recordHistoryEntry( historyEntry );
  
          loadSourceCanvasFromLayer( adjustingLayer );
          
        }
  
        //the saturation slider
        {
          const saturationSlider = UI.make.numberSlider({
            label: "Saturation", slideMode: "contain-range",
            value: 0, min: -1, max: 1, step: 0.01,
          });
          saturationSlider.classList.add( "saturation-slider" );
          saturationSlider.onupdate = v => ( colorAdjustments.saturation = v, updateColorAdjustPreview() );
          colorAdjustToolOptionsRow.appendChild( saturationSlider );
        }
        
        //the contrast slider
        {
          const contrastSlider = UI.make.numberSlider({
            label: "Contrast", slideMode: "contain-range",
            value: 0, min: -1, max: 1, step: 0.01,
          });
          contrastSlider.classList.add( "contrast-slider" );
          contrastSlider.onupdate = v => ( colorAdjustments.contrast = v, updateColorAdjustPreview() );
          colorAdjustToolOptionsRow.appendChild( contrastSlider );
        }
  
        //the brightness slider
        {
          const brightnessSlider = UI.make.numberSlider({
            label: "Brightness", slideMode: "contain-range",
            value: 0, min: -1, max: 1, step: 0.01,
          });
          brightnessSlider.classList.add( "brightness-slider" );
          brightnessSlider.onupdate = v => ( colorAdjustments.brightness = v, updateColorAdjustPreview() );
          colorAdjustToolOptionsRow.appendChild( brightnessSlider );
        }
  
        //the hue slider
        {
          const hueSlider = UI.make.numberSlider({
            label: "Hue", slideMode: "contain-range",
            value: 0, min: 0, max: 1, step: 0.01,
          });
          hueSlider.classList.add( "hue-slider" );
          hueSlider.onupdate = v => ( colorAdjustments.hue = v, updateColorAdjustPreview() );
          colorAdjustToolOptionsRow.appendChild( hueSlider );
        }
  
        //the invert slider
        {
          const invertSlider = UI.make.numberSlider({
            label: "Invert", slideMode: "contain-range",
            value: 0, min: 0, max: 1, step: 0.01,
          });
          invertSlider.classList.add( "Invert-slider" );
          invertSlider.onupdate = v => ( colorAdjustments.invert = v, updateColorAdjustPreview() );
          colorAdjustToolOptionsRow.appendChild( invertSlider );
        }
        
        //the apply button
        {
          const applyButton = document.createElement( "div" );
          applyButton.classList.add( "asset-button-text", "round-toggle", "long", "on" );
          const buttonText = document.createElement( "div" );
          buttonText.classList.add( "button-text" );
          buttonText.textContent = "Apply";
          applyButton.appendChild( buttonText );
          UI.registerElement(
            applyButton,
            {
              onclick: () => {
                finalizeColorAdjust();
              },
            },
            { tooltip: [ "Apply Color Adjustments", "below", "to-left-of-center" ] }
          );
          colorAdjustToolOptionsRow.appendChild( applyButton );
        }
  
      }
  
      //the flood fill tool options
      {
        const floodFillOptionsRow = document.createElement( "div" );
        floodFillOptionsRow.classList.add( "flex-row", "hidden", "animated" );
        floodFillOptionsRow.id = "flood-fill-tools-options-row";
        toolOptionsRow.appendChild( floodFillOptionsRow );
        UI.registerElement(
          floodFillOptionsRow,
          {
            updateContext: () => {
              if( uiSettings.isActiveTool( "flood-fill" ) ) {
                floodFillOptionsRow.classList.remove( "hidden" );
              }
              else {
                floodFillOptionsRow.classList.add( "hidden" );
              }
            }
          },
          {
            zIndex: 1000,
          }
        );
  
        //uiSettings.toolsSettings["flood-fill"].erase = true | false
        //the erase toggle
        {
          const eraseToggle = document.createElement( "div" );
          //brushSelectBrowseButton.classList.add( "asset-browser-button" );
          eraseToggle.classList.add( "flood-fill-options-erase-toggle", "round-toggle", "on" );
          UI.registerElement(
            eraseToggle,
            {
              onclick: () => {
                let erasing = uiSettings.toolsSettings["flood-fill"].erase;
                erasing = ! erasing;
                uiSettings.toolsSettings["flood-fill"].erase = erasing;
                if( erasing === true ) eraseToggle.classList.add( "on" );
                if( erasing === false ) eraseToggle.classList.remove( "on" );
              },
              updateContext: () => {
                if( uiSettings.toolsSettings["flood-fill"].erase === true ) eraseToggle.classList.add( "on" );
                else eraseToggle.classList.remove( "on" );
              }
            },
            { tooltip: [ "Flood Erase Mode", "below", "to-right-of-center" ], zIndex:10000, }
          );
          floodFillOptionsRow.appendChild( eraseToggle );
        }
        //vertical-spacer
        //need a toggle for area vs. color
        //uiSettings.toolsSettings["flood-fill"].floodTarget = "area" | "color"
        {
          const colorToggle = document.createElement( "div" );
          //brushSelectBrowseButton.classList.add( "asset-browser-button" );
          colorToggle.classList.add( "flood-fill-options-color-toggle", "round-toggle", "on" );
          UI.registerElement(
            colorToggle,
            {
              onclick: () => {
                let current = uiSettings.toolsSettings["flood-fill"].floodTarget;
  
                if( current === "area" ) current = "color";
                else current = "area";
  
                uiSettings.toolsSettings["flood-fill"].floodTarget = current;
  
                if( current === "area" ) colorToggle.classList.remove( "on" );
                if( current === "color" ) colorToggle.classList.add( "on" );
              },
              updateContext: () => {
                let current = uiSettings.toolsSettings["flood-fill"].floodTarget;
                if( current === "area" ) colorToggle.classList.remove( "on" );
                if( current === "color" ) colorToggle.classList.add( "on" );
              }
            },
            { tooltip: [ "Flood Color Instead of Area", "below", "to-right-of-center" ], zIndex:10000, }
          );
          floodFillOptionsRow.appendChild( colorToggle );
        }
        //vertical-spacer
        //slider for tolerance
        {
          const toleranceSlider = UI.make.numberSlider({
            label: "Tolerance", slideMode: "contain-step",
            value: uiSettings.toolsSettings["flood-fill"].tolerance, min: 0, max: 1, step: 0.01
          });
          toleranceSlider.classList.add( "flood-fill-options-tolerance-slider" );
          toleranceSlider.onend = tolerance => uiSettings.toolsSettings["flood-fill"].tolerance = tolerance;
          floodFillOptionsRow.appendChild( toleranceSlider ); 
        }
        //slider for padding
        {
          const paddingSlider = UI.make.numberSlider({
            label: "Padding", slideMode: "contain-step",
            value: uiSettings.toolsSettings["flood-fill"].padding, min: 0, max: 10, step: 0.1
          });
          paddingSlider.classList.add( "flood-fill-options-padding-slider" );
          paddingSlider.onend = padding => uiSettings.toolsSettings["flood-fill"].padding = padding;
          floodFillOptionsRow.appendChild( paddingSlider ); 
        }
  
        //the colorwell is here, but it's swiped from the paint tools
  
      }
  
      //the lasso tool options
      {
        const lassoOptionsRow = document.createElement( "div" );
        lassoOptionsRow.classList.add( "flex-row", "hidden", "animated" );
        lassoOptionsRow.id = "lasso-tools-options-row";
        toolOptionsRow.appendChild( lassoOptionsRow );
        UI.registerElement(
          lassoOptionsRow,
          {
            updateContext: () => {
              if( uiSettings.isActiveTool( "lasso" ) ) {
                lassoOptionsRow.classList.remove( "hidden" );
              }
              else {
                lassoOptionsRow.classList.add( "hidden" );
              }
            }
          },
          {
            zIndex: 1000,
          }
        );
  
        //the shape select button
        {
          const lassoChangeShapeButton = document.createElement( "div" );
          lassoChangeShapeButton.classList.add( "lasso-options-lasso-change-shape", "free-shape", "round-toggle", "on" );
          lassoChangeShapeButton.id = "lasso-change-shape-button";
          let showingLassoShapesPanel = false;
          UI.registerElement(
            lassoChangeShapeButton,
            {
              onclick: () => {
                if( showingLassoShapesPanel === true ) {
                  UI.deleteContext( "lasso-change-shape-panel-visible" );
                } else {
                  UI.addContext( "lasso-change-shape-panel-visible" );
                }
                lassoChangeShapeButton.classList.add( "pushed" );
                setTimeout( () => lassoChangeShapeButton.classList.remove( "pushed" ), UI.animationMS );
              },
              updateContext: () => {
                if( uiSettings.toolsSettings.lasso.shape === "free" ) {
                  lassoChangeShapeButton.classList.remove( "free-shape", "ellipse-shape", "rect-shape", "eyedropper-shape" );
                  lassoChangeShapeButton.classList.add( "free-shape" );
                }
                else if( uiSettings.toolsSettings.lasso.shape === "ellipse" ) {
                  lassoChangeShapeButton.classList.remove( "free-shape", "rect-shape", "eyedropper-shape" );
                  lassoChangeShapeButton.classList.add( "ellipse-shape" );
                }
                else if( uiSettings.toolsSettings.lasso.shape === "rect" ) {
                  lassoChangeShapeButton.classList.remove( "free-shape", "ellipse-shape", "eyedropper-shape" );
                  lassoChangeShapeButton.classList.add( "rect-shape" );
                }
                else if( uiSettings.toolsSettings.lasso.shape === "eyedropper" ) {
                  lassoChangeShapeButton.classList.remove( "free-shape", "ellipse-shape", "rect-shape" );
                  lassoChangeShapeButton.classList.add( "eyedropper-shape" );
                }
              }
            },
            {
              tooltip: [ "Change Lasso Shape: Free", "below", "to-right-of-center" ], zIndex:10000,
            }
          );
          lassoOptionsRow.appendChild( lassoChangeShapeButton );

          
          //the lasso shape hovering panel
          {

            const lassoShapePanel = document.createElement( "div" );
            lassoShapePanel.classList.add( "animated" );
            lassoShapePanel.id = "lasso-shape-panel";
            lassoChangeShapeButton.appendChild( lassoShapePanel );

            //add the stylized summon marker arrow to the top-right
            const summonMarker = document.createElement( "div" );
            summonMarker.classList.add( "summon-marker" );
            lassoShapePanel.appendChild( summonMarker );

            UI.registerElement( lassoShapePanel, {
              onclickout: () => {
                UI.deleteContext( "lasso-change-shape-panel-visible" );
              },
              updateContext: context => {
                if( context.has( "lasso-change-shape-panel-visible" ) ) lassoShapePanel.classList.remove( "hidden" );
                else lassoShapePanel.classList.add( "hidden" );
              },
            }, { zIndex: 10000 } );

            //the lasso free shape button
            {
              const lassoFreeShapeButton = lassoShapePanel.appendChild( document.createElement( "div" ) );
              lassoFreeShapeButton.classList.add( "rounded-line-button", "animated" );
              lassoFreeShapeButton.appendChild( new Image() ).src = "icon/lasso-shape-free.png";
              lassoFreeShapeButton.appendChild( document.createElement("span") ).textContent = "Lasso Free Draw";
              UI.registerElement( lassoFreeShapeButton, {
                onclick: () => {
                  lassoFreeShapeButton.classList.add( "pushed" );
                  setTimeout( () => lassoFreeShapeButton.classList.remove( "pushed" ), UI.animationMS );
                  uiSettings.toolsSettings.lasso.shape = "free";
                  UI.deleteContext( "lasso-change-shape-panel-visible" ); //calls update context
                }
              }, { 
                tooltip: [ "Set Lasso Shape to Free Draw", "to-left", "vertical-center" ],
                zIndex: 11000
              } );
            }

            //add a spacer
            lassoShapePanel.appendChild( document.createElement( "div" ) ).className = "spacer";

            //the lasso rect shape button
            {
              const lassoRectShape = lassoShapePanel.appendChild( document.createElement( "div" ) );
              lassoRectShape.classList.add( "rounded-line-button", "animated" );
              lassoRectShape.appendChild( new Image() ).src = "icon/lasso-shape-rect.png";
              lassoRectShape.appendChild( document.createElement("span") ).textContent = "Lasso Rectangle";
              UI.registerElement( lassoRectShape, {
                onclick: () => {
                  lassoRectShape.classList.add( "pushed" );
                  setTimeout( () => lassoRectShape.classList.remove( "pushed" ), UI.animationMS );
                  uiSettings.toolsSettings.lasso.shape = "rect";
                  UI.deleteContext( "lasso-change-shape-panel-visible" ); //calls update context
                }
              }, { 
                tooltip: [ "Set Lasso Shape to Rectangle", "to-left", "vertical-center" ],
                zIndex: 11000
              } );
            }

            //add a spacer
            lassoShapePanel.appendChild( document.createElement( "div" ) ).className = "spacer";

            //the lasso ellipse shape button
            {
              const lassoEllipseShape = lassoShapePanel.appendChild( document.createElement( "div" ) );
              lassoEllipseShape.classList.add( "rounded-line-button", "animated" );
              lassoEllipseShape.appendChild( new Image() ).src = "icon/lasso-shape-ellipse.png";
              lassoEllipseShape.appendChild( document.createElement("span") ).textContent = "Lasso Ellipse";
              UI.registerElement( lassoEllipseShape, {
                onclick: () => {
                  lassoEllipseShape.classList.add( "pushed" );
                  setTimeout( () => lassoEllipseShape.classList.remove( "pushed" ), UI.animationMS );
                  uiSettings.toolsSettings.lasso.shape = "ellipse";
                  UI.deleteContext( "lasso-change-shape-panel-visible" ); //calls update context
                }
              }, { 
                tooltip: [ "Set Lasso Shape to Ellipse", "to-left", "vertical-center" ],
                zIndex: 11000
              } );
            }

          }


        }
      
        //the cancel lasso button
        {
          const cancelLasso = document.createElement( "div" );
          cancelLasso.classList.add( "lasso-options-cancel-lasso", "round-toggle" );
          UI.registerElement(
            cancelLasso,
            {
              onclick: () => {
                clearLassoStack();
              },
              updateContext: () => {}
            },
            {
              tooltip: [ "Cancel Lasso", "below", "to-right-of-center" ],
              zIndex:10000,
              bindings: {
                "Cancel Lasso": clearLassoStack
              }
            }
          );
          lassoOptionsRow.appendChild( cancelLasso );
        }
        
        //the invert lasso button
        {
          const invertLassoButton = document.createElement( "div" );
          invertLassoButton.classList.add( "lasso-options-invert-lasso", "round-toggle" );

          function invertLasso() {
            lassoResources.invert = ! lassoResources.invert;
          }

          UI.registerElement(
            invertLassoButton,
            {
              onclick: invertLasso,
              updateContext: () => {
                if( lassoResources.invert === true ) invertLassoButton.classList.add( "on" );
                else invertLassoButton.classList.remove( "on" );
              }
            },
            {
              tooltip: [ "Invert Lasso", "below", "to-right-of-center" ],
              zIndex:10000,
              bindings: {
                "Invert Lasso": invertLasso
              }
            }
          );
          lassoOptionsRow.appendChild( invertLassoButton );
        }
        
        //the cut lassoed area button
        {
          const cutLassoedAreaButton = document.createElement( "div" );
          cutLassoedAreaButton.classList.add( "lasso-options-cut-lassoed-area", "round-toggle" );

          function duplicateLassoedArea() {
            const selectedLayers = getSelectedOrBatchedLayers( false );
            const selectedPaintLayers = selectedLayers.filter( l => l.layerType === "paint" );
            if( selectedPaintLayers.length > 0 ) {
              const copiedLayers = duplicateLayersAndRecordUndo( selectedPaintLayers, false );
              const duplicateUndoEvent = history.pop();
              cutLayersToLassoAreas( copiedLayers, true, true );
              const cutToLassoUndoEvent = history.pop();
              cutLayersToLassoAreas( selectedPaintLayers, false, true );
              const cutOutLassoUndoEvent = history.pop();
              const historyEntry = {
                undo: () => {
                  cutOutLassoUndoEvent.undo();
                  cutToLassoUndoEvent.undo();
                  duplicateUndoEvent.undo();
                },
                redo: () => {
                  duplicateUndoEvent.redo();
                  cutToLassoUndoEvent.redo();
                  cutOutLassoUndoEvent.redo();
                }
              }
              recordHistoryEntry( historyEntry );
            }
          }

          UI.registerElement(
            cutLassoedAreaButton,
            {
              onclick: duplicateLassoedArea,
              updateContext: () => {}
            },
            {
              tooltip: [ "Cut Out Lassoed Area", "below", "to-right-of-center" ],
              zIndex:10000,
              bindings: {
                "Cut Out Lassoed Area": duplicateLassoedArea
              }
            }
          );
          lassoOptionsRow.appendChild( cutLassoedAreaButton );
        }

        //the duplicate lassoed area button
        {
          const duplicateLassoedAreaButton = document.createElement( "div" );
          duplicateLassoedAreaButton.classList.add( "lasso-options-duplicate-lassoed-area", "round-toggle" );

          function duplicateLassoedArea() {
            const selectedLayers = getSelectedOrBatchedLayers( false );
            const selectedPaintLayers = selectedLayers.filter( l => l.layerType === "paint" );
            if( selectedPaintLayers.length > 0 ) {
              const copiedLayers = duplicateLayersAndRecordUndo( selectedPaintLayers, false );
              const duplicateUndoEvent = history.pop();
              cutLayersToLassoAreas( copiedLayers, true, true );
              const cutToLassoUndoEvent = history.pop();
              const historyEntry = {
                undo: () => {
                  cutToLassoUndoEvent.undo();
                  duplicateUndoEvent.undo();
                  reorganizeLayerButtons();
                  UI.updateContext();
                },
                redo: () => {
                  duplicateUndoEvent.redo();
                  cutToLassoUndoEvent.redo();
                  reorganizeLayerButtons();
                  UI.updateContext();
                }
              }
              recordHistoryEntry( historyEntry );
            }
          }

          UI.registerElement(
            duplicateLassoedAreaButton,
            {
              onclick: duplicateLassoedArea,
              updateContext: () => {}
            },
            {
              tooltip: [ "Duplicate Lassoed Area", "below", "to-right-of-center" ],
              zIndex:10000,
              bindings: {
                "Duplicate Lassoed Area": duplicateLassoedArea
              }
            }
          );
          lassoOptionsRow.appendChild( duplicateLassoedAreaButton );
        }

        //the delete lassoed area button
        {
          const deleteLassoedAreaButton = document.createElement( "div" );
          deleteLassoedAreaButton.classList.add( "lasso-options-delete-lassoed-area", "round-toggle" );

          function duplicateLassoedArea() {
            const selectedLayers = getSelectedOrBatchedLayers( false );
            const selectedPaintLayers = selectedLayers.filter( l => l.layerType === "paint" );
            if( selectedPaintLayers.length > 0 )
              cutLayersToLassoAreas( selectedPaintLayers, false, true );
          }

          UI.registerElement(
            deleteLassoedAreaButton,
            {
              onclick: duplicateLassoedArea,
              updateContext: () => {}
            },
            {
              tooltip: [ "Delete Lassoed Area", "below", "to-right-of-center" ],
              zIndex:10000,
              bindings: {
                "Delete Lassoed Area": duplicateLassoedArea
              }
            }
          );
          lassoOptionsRow.appendChild( deleteLassoedAreaButton );
        }
        
      }
    }

    //a vertical spacer divider
    {
      const verticalSpacer = document.createElement( "div" );
      verticalSpacer.classList.add( "vertical-spacer" );
      canvasControlsOptionsRow.appendChild( verticalSpacer );
    }

    //the colorwell
    {
      const colorWell = document.createElement( "div" );
      colorWell.classList.add( "paint-tools-options-color-well", "animated" );
      colorWell.style.backgroundColor = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.getColorStyle();
      UI.registerElement(
        colorWell,
        {
          onclick: () => {
            colorWell.style.backgroundColor = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.getColorStyle();
            document.querySelector( "#color-wheel" )?.toggleVisibility?.();
          },
          updateContext: () => {
            if( ["paint","flood-fill"].includes( uiSettings.activeTool ) ) colorWell.classList.remove( "hidden" );
            else colorWell.classList.add( "hidden" );
          }
        },
        {
          tooltip: [ "Change Color", "below", "to-left-of-center" ], zIndex:10000,
        }
      );
      canvasControlsOptionsRow.appendChild( colorWell );
    }
  }

  //the transform tool options
  {
    
    const transformToolOptionsRow = document.createElement( "div" );
    transformToolOptionsRow.classList.add( "flex-row", "hidden", "animated" );
    transformToolOptionsRow.id = "transform-tools-options-row";
    uiContainer.appendChild( transformToolOptionsRow );
    const currentTransformInfos = [];

    //I want to click the tool and see my layer's angle, scale, dims, and center{xy}
    //I want to touch-transform and see those change live
    //That means I need some way of reacting to the transform event
    //I'll expose a function and call it from the layer transform updater

    //When we're trxing multiple layers, the crop function is unavailable
    //That also means the on-screen handles are not shown?
    //No, for readability, we need to see the on-screen handles.
    //That also means we need an onscreen gizmo for zoom/pan. But corner is no-go. Hmm.

    let activeTransform = false;

    function isActiveTransform() {
      return uiSettings.isActiveTool( "transform" ) && (
        layerTransform.pan.x !== 0 ||
        layerTransform.pan.y !== 0 ||
        layerTransform.zoom !== 1 ||
        layerTransform.angle !== 0
      );
    }

    const updateView = ( updateCurrent = true, updateSliders = true ) => {
      if( uiSettings.activeTool !== "transform" || currentTransformInfos.length === 0 ) {
        return;
      }

      getTransform();
      
      if( activeTransform === true && isActiveTransform() === false ) {
        activeTransform = false;
        loadLayers( currentTransformInfos.map( info => info.layer ) );
        return;
      }
      //called by updateCycle() on layer transforming
      //update all the values shown on our sliders.
      //if we only have one layer, update our crop handles

      getLayerTransform();

      //update all our values via computation
      if( updateCurrent === true ) {
        currentTransformInfos.forEach( info => updateLayerTransformInfoWithCurrent( info ) );
      }

      //get our aggregate info
      const aggregateInfo = getAggregateTransformInfo();
      if( updateSliders === true ) {
        //update our sliders
        transformToolOptionsRow.querySelector(".rotation-slider").setValue( parseInt( Math.round( (aggregateInfo.angle / (2*Math.PI)) * 360 ) ) );
        transformToolOptionsRow.querySelector(".scale-slider").setValue( aggregateInfo.scale );
        transformToolOptionsRow.querySelector(".x-slider").setValue( aggregateInfo.center.x );
        transformToolOptionsRow.querySelector(".y-slider").setValue( aggregateInfo.center.y );
        if( currentTransformInfos.length === 1 ) {
          transformToolOptionsRow.querySelector(".width-slider").setValue( currentTransformInfos[0].layer.w );
          transformToolOptionsRow.querySelector(".height-slider").setValue( currentTransformInfos[0].layer.h );
        }
      }

      //update our transform handles
      
      for( const handle of document.querySelectorAll( ".transform-handle" ) ) {
        handle.updateView( aggregateInfo );
      }
    }
    
    const loadLayers = layers => {
      currentTransformInfos.length = 0;
      getLayerTransform();
      for( const layer of layers ) {
        currentTransformInfos.push( getInitialLayerTransformInfo( layer ) );
      }
      updateView( false );
    }
    const applyCropAndRecordUndo = ( width, height, x=null, y=null ) => {
      //crop happens on dragging and releasing a handle.
      const layer = currentTransformInfos[0].layer;
      cropLayerSizeAndRecordUndo( layer, width, height, x, y );
    }

    //The apply rotation and apply scale functions do not record undo.
    //Instead, we use them to update a live preview during the slider drag.
    //On the slider release (or number text entry etc.), we call recordTransformUndo()
    const applyScaleAndRotationToLayersFromInitial = ( dRadians, dScale ) => {
      //for every point in all our layers:
      //  take it as a vector from the center
      //  rotate by rotation
      //  store the new point
      const fromInitial = true;
      //const { center, angle } = getAggregateTransformInfo( fromInitial );
      const { center: { x: centerX, y: centerY } } = getAggregateTransformInfo( fromInitial );
      
      const angleChange = dRadians;
      const scaleFactor = dScale;
      for( const {layer,initial} of currentTransformInfos ) {
        for( const pointName of ["topLeft","bottomLeft","topRight","bottomRight"] ) {
          const layerPoint = layer[ pointName ],
            initialPoint = initial[ pointName ];
          const dx = initialPoint[0] - centerX,
            dy = initialPoint[1] - centerY,
            pointInitialAngle = Math.atan2( dy, dx ),
            l = Math.sqrt( dx**2 + dy**2 );
          layerPoint[ 0 ] = centerX + l * Math.cos( pointInitialAngle + angleChange ) * scaleFactor;
          layerPoint[ 1 ] = centerY + l * Math.sin( pointInitialAngle + angleChange ) * scaleFactor;
        }
      }
    }
    const applyRotationToLayersFromInitial = rotation => {
      //for every point in all our layers:
      //  take it as a vector from the center
      //  rotate by rotation
      //  store the new point
      const fromInitial = true;
      const { center, angle } = getAggregateTransformInfo( fromInitial );
      const { x: centerX, y: centerY } = center;
      const angleChange = ( ( rotation / 360 ) * Math.PI * 2 ) - angle;
      for( const {layer,initial} of currentTransformInfos ) {
        for( const pointName of ["topLeft","bottomLeft","topRight","bottomRight"] ) {
          const layerPoint = layer[ pointName ],
            initialPoint = initial[ pointName ];
          const dx = initialPoint[0] - centerX,
            dy = initialPoint[1] - centerY,
            pointInitialAngle = Math.atan2( dy, dx ),
            l = Math.sqrt( dx**2 + dy**2 );
          layerPoint[ 0 ] = centerX + l * Math.cos( pointInitialAngle + angleChange );
          layerPoint[ 1 ] = centerY + l * Math.sin( pointInitialAngle + angleChange );
        }
      }
    }
    const applyScaleToLayersFromInitial = appliedScale => {
      //for every point in all our layers:
      //  take it as a vector from the center
      //  scale by scale
      //  store the new point
      const fromInitial = true;
      const { center: { x: centerX, y: centerY }, scale: initialScale } = getAggregateTransformInfo( fromInitial );
      const scale = appliedScale / initialScale;
      for( const {layer, initial} of currentTransformInfos ) {
        for( const pointName of ["topLeft","bottomLeft","topRight","bottomRight"] ) {
          const layerPoint = layer[ pointName ],
            initialPoint = initial[ pointName ];
          const dx = initialPoint[0] - centerX,
            dy = initialPoint[1] - centerY;
          layerPoint[ 0 ] = centerX + dx * scale;
          layerPoint[ 1 ] = centerY + dy * scale;
        }
      }
    }
    const applyXYToLayersFromInitial = ( x = null, y = null ) => {
      //for every point in all our layers:
      //  take it as a vector from the center
      //  scale by scale
      //  store the new point
      const fromInitial = true;
      const { x: centerX, y: centerY } = getAggregateTransformInfo( fromInitial ).center;
      if( x === null ) x = centerX;
      if( y === null ) y = centerY;
      const dx = x - centerX, dy = y - centerY;
      for( const {layer, initial} of currentTransformInfos ) {
        for( const pointName of ["topLeft","bottomLeft","topRight","bottomRight"] ) {
          const layerPoint = layer[ pointName ],
            initialPoint = initial[ pointName ];
          layerPoint[ 0 ] = initialPoint[0] + dx;
          layerPoint[ 1 ] = initialPoint[1] + dy;
        }
      }
    }

    const recordTransformUndo = () => {
      //transform undo happens when one of our sliders (angle or scale) is released
      const layerStates = [];
      for( const {layer,initial} of currentTransformInfos ) {
        layerStates.push({
          layer,
          oldPoints: initial,
          newPoints: {
            topLeft: [...layer.topLeft],
            bottomLeft: [ ...layer.bottomLeft ],
            topRight: [...layer.topRight],
            bottomRight: [...layer.bottomRight]
          }
        })
      }
      const historyEntry = {
        layerStates,
        undo: () => {
          for( const {layer,oldPoints} of layerStates ) {
            for( const point of ["topLeft","bottomLeft","topRight","bottomRight"] )
              layer[point] = [...oldPoints[point]];
          }
        },
        redo: () => {
          for( const {layer,newPoints} of layerStates ) {
            for( const point of ["topLeft","bottomLeft","topRight","bottomRight"] )
              layer[point] = [...newPoints[point]];
          }
        }
      }
      recordHistoryEntry( historyEntry );
      //reload the layers
      
    }
    const getAggregateTransformInfo = ( fromInitial = false ) => {
      let center = {x:0,y:0},
        transformedPoints = {topLeft:null,bottomLeft: null,topRight: null,bottomRight: null},
        globalPoints = {topLeft:null,bottomLeft: null,topRight: null,bottomRight: null},
        scale = currentTransformInfos[0].scale,
        angle = currentTransformInfos[0].angle;
        //minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

      //old naive approach to multi-scale-angle:
      if( currentTransformInfos.length > 1 ) {
        scale = layerTransform.zoom || 1;
        angle = ( layerTransform.angle + layerTransform.initialAngleOffset ) || 0;
        //what about for initial? This doesn't make sense IMO
        //Hmm. No, okay. It does. If we have multiple layers, absolute angle and scale don't make sense. So everything is relative to 1 / 100%.
      }

      const pointCountScale = 1 / (currentTransformInfos.length * 4);
      if( uiSettings.toolsSettings.transform.current ) getLayerTransform();
      for( const {current,initial} of currentTransformInfos ) {
        //we want the live info from the layer, not our initial static info
        for( const pointName of ["topLeft","bottomLeft","topRight","bottomRight"] ) {
          let source = fromInitial ? initial : current;
          const [x,y] =
            ( fromInitial === false && uiSettings.toolsSettings.transform.current ) ?
            transformLayerPoint( source[pointName] ) : source[ pointName ];
          if( currentTransformInfos.length === 1 ) {
            transformedPoints[ pointName ] = [ x, y, 1 ];
            globalPoints[ pointName ] = [ ...source[ pointName ] ];
          }
          //global-space bounding box not used?
          //else { minX = Math.min( minX, x ); maxX = Math.max( maxX, x ); minY = Math.min( minY, y ); maxY = Math.max( maxY, y ); }
          center.x += x * pointCountScale;
          center.y += y * pointCountScale;
        }
      }
      if( currentTransformInfos.length > 1 ) {

        //find the biggest layer
        let biggestPointSource = null, biggestLayer, size = 0;
        for( const { initial, current, layer } of currentTransformInfos ) {
          const source = fromInitial ? initial : current;
          const w = Math.sqrt((source.topRight[0] - source.topLeft[0])**2 + (source.topRight[1] - source.topLeft[1])**2),
            h = Math.sqrt((source.bottomLeft[0] - source.topLeft[0])**2 + (source.bottomLeft[1] - source.topLeft[1])**2);
          if( w * h > size ) {
            biggestPointSource = source;
            biggestLayer = layer;
            size = w * h;
          }
        }

        const referencePoints = biggestPointSource;
        //get its normalized coordinate space (we won't transform anything; want global coords)
        const origin = [...referencePoints.topLeft];
        const hAxis = [ referencePoints.topRight[0] - origin[0], referencePoints.topRight[1] - origin[1] ],
          hAxisLength = Math.sqrt( hAxis[0]**2 + hAxis[1]**2 ),
          hAxisNorm = [ hAxis[0] / hAxisLength, hAxis[1] / hAxisLength ],
          vAxis = [ referencePoints.bottomLeft[0] - origin[0], referencePoints.bottomLeft[1] - origin[1] ],
          vAxisLength = Math.sqrt( vAxis[0]**2 + vAxis[1]**2 ),
          vAxisNorm = [ vAxis[0] / vAxisLength, vAxis[1] / vAxisLength ];

        let minH = Infinity, maxH = -Infinity,
          minV = Infinity, maxV = -Infinity;

        for( const { initial, current } of currentTransformInfos ) {
          const source = fromInitial ? initial : current;
          //if( source === referencePoints ) continue;
          for( const pointName of ["topLeft","bottomLeft","topRight","bottomRight"] ) {
            const [ globalX, globalY ] = source[ pointName ];
            const dx = globalX - origin[ 0 ],
              dy = globalY - origin[ 1 ];
            const localHProj = dx * hAxisNorm[0] + dy * hAxisNorm[1],
              localH = localHProj / hAxisLength,
              localVProj = dx * vAxisNorm[0] + dy * vAxisNorm[1],
              localV = localVProj / vAxisLength;
              minH = Math.min( minH, localH );
              maxH = Math.max( maxH, localH );
              minV = Math.min( minV, localV );
              maxV = Math.max( maxV, localV );
          }
        }

        globalPoints = {
          topLeft: [
            origin[0] + minH * hAxis[0] + minV * vAxis[0],
            origin[1] + minH * hAxis[1] + minV * vAxis[1],
            1
          ],
          topRight: [
            origin[0] + maxH * hAxis[0] + minV * vAxis[0],
            origin[1] + maxH * hAxis[1] + minV * vAxis[1],
            1
          ],
          bottomRight: [
            origin[0] + maxH * hAxis[0] + maxV * vAxis[0],
            origin[1] + maxH * hAxis[1] + maxV * vAxis[1],
            1
          ],
          bottomLeft: [
            origin[0] + minH * hAxis[0] + maxV * vAxis[0],
            origin[1] + minH * hAxis[1] + maxV * vAxis[1],
            1
          ]
        }

        let scaleFactor = 1, angleOffset = 0;

        if( fromInitial === false && uiSettings.toolsSettings.transform.current ) {
          console.log( "here" );
          transformedPoints.topLeft = [...transformLayerPoint( globalPoints.topLeft )];
          transformedPoints.topRight = [...transformLayerPoint( globalPoints.topRight )];
          transformedPoints.bottomRight = [...transformLayerPoint( globalPoints.bottomRight )];
          transformedPoints.bottomLeft = [...transformLayerPoint( globalPoints.bottomLeft )];

          //get the angleOffset
          angleOffset = Math.atan2( -_layerTranform[ 1 ], _layerTranform[ 0 ] );
          //get the scale factor
          scaleFactor = Math.sqrt( _layerTranform[0]**2 + _layerTranform[1]**2 );

        } else {
          transformedPoints.topLeft = [...globalPoints.topLeft];
          transformedPoints.topRight = [...globalPoints.topRight];
          transformedPoints.bottomRight = [...globalPoints.bottomRight];
          transformedPoints.bottomLeft = [...globalPoints.bottomLeft];
        }

        //set the scale and angle
        scale = scaleFactor * hAxisLength / biggestLayer.w;
        angle = Math.atan2( hAxis[1], hAxis[0] ) + angleOffset;

        /* 
          TODO:
          1. find the biggest layer
            1.a for layer, if w*h > biggest, set biggest
          2. get its normalized coordinate vectors
          3. for each other layer's point
            3.a component-wise-product-sum (dot product) that point with the normalizedHorizontalVector to get full-sized X
            3.b component-wise-product-sum (dot product) that point with the normalizedVerticalVector to get full-sized Y
            3.c divide full-sized x and y by the horizontalAxisLength and verticalAxisLength, respectively
            3.d that produces a range 0->1 (and beyond) point lying within (or beyond) the bounding box of the biggest layer
            3.e use minH,minV,maxH,maxV to track all of these 0->1 points as a bounding box
          4. create a set of new corners
            4.a origin + (minX,minY); origin + (maxX,minY) ...
            4.b to compute one point (minH,minV), do:
              origin.x + minH * horizontalVector.x + minV * verticalVector.x
              origin.y + minH * horizontalVector.y + minV * verticalVector.y
          !. These set of corners are our global-coordinates bounding box
            - transform with matrix function to cast to screen coordinates

          When do we need to perform this operation?
          Probably doesn't matter. Don't optimize for now. Make a note I guess.

        */

        //former naive box
        /* points.topLeft = { x: minX, y: minY };
        points.topRight = { x: maxX, y: minY };
        points.bottomLeft = { x: minX, y: maxY };
        points.bottomRight = { x: maxX, y: maxY }; */
      }
      return { center, transformedPoints, globalPoints, scale, angle };
    }
    const updateLayerTransformInfoWithCurrent = ( layerInfo ) => {
      //getLayerTransform(); //call this elsewhere for batching
      for( const pointName of ["topLeft","bottomLeft","topRight","bottomRight"] ) {
        layerInfo.current[ pointName ] = [ ...layerInfo.layer[ pointName ] ];
        layerInfo.currentTransformed[ pointName ] = [ ...transformLayerPoint( layerInfo.layer[ pointName ] ) ];
      }
      const { topRight, topLeft, bottomRight, bottomLeft } = layerInfo.currentTransformed;
      const topEdge = [topRight[0]-topLeft[0],topRight[1]-topLeft[1]],
        topEdgeLength = Math.sqrt( topEdge[0]**2 + topEdge[1]**2 ),
        scale = topEdgeLength / layerInfo.layer.w,
        angle = Math.atan2( topEdge[1], topEdge[0] );
      const center = {
        x:(topLeft[0] + topRight[0] + bottomLeft[0] + bottomRight[0]) / 4,
        y:(topLeft[1] + topRight[1] + bottomLeft[1] + bottomRight[1]) / 4,
      }
      //scale, center, and angle are all transformed to the view
      layerInfo.scale = scale;
      layerInfo.angle = angle;
      layerInfo.center = center;
      if( isActiveTransform() === true ) {
        activeTransform = true;
      }
    }
    const getInitialLayerTransformInfo = layer => {
      const topLeft = [...layer.topLeft], bottomRight = [...layer.bottomRight],
        topRight = [...layer.topRight], bottomLeft = [...layer.bottomLeft];
      const layerInfo = {
        layer,
        initial: { topLeft, bottomRight, topRight, bottomLeft },
        current: {},
        currentTransformed: {},
        scale: null, angle: null, center: null
      }
      updateLayerTransformInfoWithCurrent( layerInfo );
      return layerInfo;
    }


    UI.registerElement(
      transformToolOptionsRow,
      {
        updateContext: () => {

          //Three basic functions: Update the slider previews, Transform layers w/ sliders, and Record Undos from sliders
          //1. On update (in updateCycle), call an exposed "updateSliderValues" function
          //2. On slider live-update, update the layer(s) tl/br/tr/bl points while saving its originals
          //3. On slider release/apply, record an undo event with pre-slide state and current state
          //4. On layer selection change, update the slider values (no undo/etc here)

          if( uiSettings.isActiveTool( "transform" ) ) {

            const selectedAndBatchedLayers = getSelectedOrBatchedLayers();

            //check if we have any selected layers, disable the tool if not
            if( selectedAndBatchedLayers.length === 0 ) {
              uiSettings.setActiveTool( null );
              transformToolOptionsRow.classList.add( "hidden" );
              return;
            }

            transformToolOptionsRow.classList.remove( "hidden" );
            document.querySelector( "#transform-handles-container" ).classList.remove( "hidden" );

            //find out what layers are currently our transform targets
            let selectedLayersTarget = [ ...selectedAndBatchedLayers ];

            const toolNames = [".rotation-slider", ".scale-slider", ".x-slider", ".y-slider", ".width-slider", ".height-slider"];

            if( selectedLayersTarget.length === 0 ) {
              //nothing to transform, hide our tools
              toolNames.forEach( tn => transformToolOptionsRow.querySelector( tn ).classList.add( "hidden" ) );
              //hide the crop handles too
            }
            if( selectedLayersTarget.length === 1 ) {
              //show all our tools
              toolNames.forEach( tn => transformToolOptionsRow.querySelector( tn ).classList.remove( "hidden" ) );
              //show the crop handles
            }
            if( selectedLayersTarget.length > 1 ) {
              //show just the rotation and scale tools
              toolNames.forEach( tn => {
                if( tn === ".width-slider" || tn === ".height-slider" ) transformToolOptionsRow.querySelector( tn ).classList.add( "hidden" );
                else transformToolOptionsRow.querySelector( tn ).classList.remove( "hidden" );
              } );
              //hide the crop handles
            }
  
            //check if our selection has changed
            let foundChange = false;
            for( const layer of selectedLayersTarget ) {
              if( ! currentTransformInfos.find( t => t.layer === layer ) ) {
                foundChange = true;
                break;
              }
            }
            if( foundChange === false ) {
              for( const {layer} of currentTransformInfos ) {
                if( selectedLayersTarget.indexOf( layer ) === -1 ) {
                  foundChange = true;
                  break;
                }
              }
            }

            //load the updated selection (this will clear datacaches)
            if( foundChange === true )
              loadLayers( selectedLayersTarget );
          }
          else {
            transformToolOptionsRow.classList.add( "hidden" );
          }
        },
        updateView,
      },
      {
        zIndex: 1000,
      }
    );

    //the rotation behavior makes sense as a real angle.
    //the rotation slider
    {
      const rotationSlider = UI.make.numberSlider({
        label: "Rotation", slideMode: "contain-step",
        value: 0, min: 0, max: 360, step: 1, wrap: true,
        bindingsName: " Layer Rotation",
        onupdate: rotation => {
          applyRotationToLayersFromInitial( rotation ),
          updateView( true, false );
        },
        onend: rotation => {
          applyRotationToLayersFromInitial( rotation );
          recordTransformUndo();
          loadLayers( currentTransformInfos.map( info => info.layer ) );
        }
      });
      rotationSlider.classList.add( "rotation-slider" );
      transformToolOptionsRow.appendChild( rotationSlider );
    }

    //the scale behavior makes sense when you consider canvas dims 100%
    //what's the layer's leg-length vs. its pixel dims?
    //the problem is the min/max don't make sense
    //the scale slider
    {
      const scaleSlider = UI.make.numberSlider({
        label: "Scale", slideMode: "contain-step",
        value: 1, min: 0.01, max: 2, step: .01,
        bindingsName: " Layer Scale",
        onupdate: scale => {
          applyScaleToLayersFromInitial( scale );
          updateView( true, false );
        },
        onend: scale => {
          applyScaleToLayersFromInitial( scale );
          recordTransformUndo();
          loadLayers( currentTransformInfos.map( info => info.layer ) );
        }
      });
      scaleSlider.classList.add( "scale-slider" );
      transformToolOptionsRow.appendChild( scaleSlider );
    }

    //the x slider
    {
      const xSlider = UI.make.numberSlider({
        label: "X", slideMode: "contain-step",
        value: 0, min: -1000, max: 1000, step: 1,
        bindingsName: " Layer X Position",
        onupdate: x => {
          applyXYToLayersFromInitial( x, null );
          updateView( true, false );
        },
        onend: x => {
          applyXYToLayersFromInitial( x, null );
          recordTransformUndo();
          loadLayers( currentTransformInfos.map( info => info.layer ) );
        }
      });
      xSlider.classList.add( "x-slider" );
      transformToolOptionsRow.appendChild( xSlider );
    }
    //the y slider
    {
      const ySlider = UI.make.numberSlider({
        label: "Y", slideMode: "contain-step",
        value: 0, min: -1000, max: 1000, step: 1,
        bindingsName: " Layer Y Position",
        onupdate: y => {
          applyXYToLayersFromInitial( null, y );
          updateView( true, false );
        },
        onend: y => {
          applyXYToLayersFromInitial( null, y );
          recordTransformUndo();
          loadLayers( currentTransformInfos.map( info => info.layer ) );
        }
      });
      ySlider.classList.add( "y-slider" );
      transformToolOptionsRow.appendChild( ySlider );
    }
    //cropping is done just with handles, not with sliders... for now at least

    //the width slider
    {
      const widthSlider = UI.make.numberSlider({
        label: "Width", slideMode: "contain-step",
        value: 512, min: 1, max: Infinity, step: 1,
        onend: width => {
          const layer = currentTransformInfos[0].layer;
          cropLayerSizeAndRecordUndo( layer, width, layer.h );
        }
      });
      widthSlider.classList.add( "width-slider" );
      transformToolOptionsRow.appendChild( widthSlider );
    }
    //the height slider
    {
      const heightSlider = UI.make.numberSlider({
        label: "Height", slideMode: "contain-step",
        value: 512, min: 1, max: Infinity, step: 1,
        onend: height => {
          const layer = currentTransformInfos[0].layer;
          cropLayerSizeAndRecordUndo( layer, layer.w, height );
        }
      });
      heightSlider.classList.add( "height-slider" );
      transformToolOptionsRow.appendChild( heightSlider );
    }
    console.error( "Add transform crop handles." );

    //the transform handles
    {

      const transformHandlesContainer = document.createElement( "div" );
      //poseRigContainer.classList.add( "hidden" );
      transformHandlesContainer.id = "transform-handles-container";

      UI.registerElement(
        transformHandlesContainer,
        {
          updateContext: () => {
            if( uiSettings.isActiveTool( "transform" ) )
              transformHandlesContainer.classList.remove( "hidden" );
            else transformHandlesContainer.classList.add( "hidden" );
          },
          //updateView,
        }
      );
      underlayContainer.appendChild( transformHandlesContainer );
  
      for( const handleName of [ "topLeft", "topRight", "bottomRight", "bottomLeft" ] ){
        let offset = null;

        const transformHandle = document.createElement( "div" );
        transformHandle.classList.add( "transform-handle" );
        transformHandle.id = "transform-handle-" + handleName;
        transformHandle.style.top = innerHeight / 2 + "px";
        transformHandle.style.left = innerWidth / 2 + "px";
        transformHandle.updateView = ( aggregateInfo ) => {
          if( typeof offset !== "number" ) {
            offset = transformHandle.getClientRects()?.[ 0 ]?.width;
          }
          const dxy = offset || 0; //must have at least 1 point appear on screen before I can get the offset.
          const { globalPoints } = aggregateInfo;
          const handlePoint = [...globalPoints[ handleName ] ];
          let [ x, y ] = transformPoint( handlePoint );
          [ x, y ] = transformLayerPoint( [ x,y,1 ] );
          //Done and bug free!!! I thought rotate-to-zero was bugged, but I just had the view rotated. :-P
          //Next is adding drag functionality to the handles.
          transformHandle.style.left = ( x / devicePixelRatio ) - dxy / 2 + "px";
          transformHandle.style.top = ( y / devicePixelRatio ) - dxy / 2 + "px";
          {
            let { x, y } = aggregateInfo.center;
            [ x, y ] = transformPoint( [ x,y,1 ] );
            [ x, y ] = transformLayerPoint( [ x,y,1 ] );
            transformHandle.center = { x: x / devicePixelRatio, y: y / devicePixelRatio };
          }
        }
        UI.registerElement(
          transformHandle,
          {
            ondrag: ({ rect, start, current, ending, starting, element }) => {
              const dx = current.x - start.x,
                dy = current.y - start.y,
                d = Math.sqrt( dx**2 + dy**2 );
              const dxCenterStart = start.x - element.center.x,
                dyCenterStart = start.y - element.center.y,
                dCenterStart = Math.sqrt( dxCenterStart**2 + dyCenterStart**2 );
              const dxCenterCurrent = current.x - element.center.x,
                dyCenterCurrent = current.y - element.center.y,
                dCenterCurrent = Math.sqrt( dxCenterCurrent**2 + dyCenterCurrent**2 );
              const dScale = dCenterCurrent / dCenterStart;
              const dAngle = Math.atan2( -dyCenterStart, dxCenterStart) - Math.atan2( -dyCenterCurrent, dxCenterCurrent );
              applyScaleAndRotationToLayersFromInitial( dAngle, dScale );
              UI.updateView();
              if( ending ) {
                recordTransformUndo();
                loadLayers( currentTransformInfos.map( info => info.layer ) );
              }
            }
          }
        );
        transformHandlesContainer.appendChild( transformHandle );
      }

    }

    const addHandle = () => {
      //hmm. How do I want to add the handles?
      //for the 4 transform corners, the ondrag function needs to update the rotation and scale of our layer(s)
      //  (which reminds me I need to add locks for rotation and scale)
      //the ondrag function ONLY needs to update the layer's rotation and scale. We'll auto-update all the nodes
      //  on a loop by pulling from the rotation and scale info also for pinch gesture
      //YEP it's a loop. The pose rig literally runs its own loop with animation request... uh no that does nothing nvmnd
      //for the 4 crop handles, the ondrag function needs to update the crop. Live-sliding those just does nothing.
      //  so I need to implement some kind of guide-preview hmm.
      //the easiest way I can imagine to do a preview... Is either to add a rect div and update its xy rotation,
      //  or else to make a screen-wide svg and add some lines and update their values

      //For starters, just add the handles and have them update as the layers transform.
      //  We can add the ondrag later. :-)

    }

  }

  //the pose rig tool options
  {
    
    const poseToolsOptionsRow = document.createElement( "div" );
    poseToolsOptionsRow.classList.add( "flex-row", "hidden", "animated" );
    poseToolsOptionsRow.id = "pose-tools-options-row";
    uiContainer.appendChild( poseToolsOptionsRow );

    UI.registerElement(
      poseToolsOptionsRow,
      {
        updateContext: () => {
          if( uiSettings.activeTool === "pose" ) {
            if( selectedLayer?.layerType !== "pose" ) {
              //uiSettings.setActiveTool( null ); //setting from rig container's updateContext; don't double-trigger
              poseToolsOptionsRow.classList.add( "hidden" );
            }
            if( selectedLayer.layerType === "pose" ) {
              poseToolsOptionsRow.classList.remove( "hidden" );
            }
          }
          else poseToolsOptionsRow.classList.add( "hidden" );
        }
      },
      {
        zIndex: 1000,
      }
    );

    
    //the move-children toggle
    {
      const moveChildrenToggle = document.createElement( "div" );
      //brushSelectBrowseButton.classList.add( "asset-browser-button" );
      moveChildrenToggle.classList.add( "pose-tools-options-move-children-toggle", "round-toggle", "on" );
      UI.registerElement(
        moveChildrenToggle,
        {
          onclick: () => {
            let moving = uiSettings.toolsSettings.pose.moveChildren;
            moving = ! moving;
            uiSettings.toolsSettings.pose.moveChildren = moving;
            if( moving === true ) moveChildrenToggle.classList.add( "on" );
            if( moving === false ) moveChildrenToggle.classList.remove( "on" );
          },
          updateContext: () => {
            if( uiSettings.toolsSettings.pose.moveChildren === true ) moveChildrenToggle.classList.add( "on" );
            else moveChildrenToggle.classList.remove( "on" );
          }
        },
        { tooltip: [ "Move Linked Nodes", "below", "to-right-of-center" ], zIndex:10000, }
      );
      poseToolsOptionsRow.appendChild( moveChildrenToggle );
    }

  }

  //the pose rig control handles
  {

    const poseRigContainer = document.createElement( "div" );
    //poseRigContainer.classList.add( "hidden" );
    poseRigContainer.id = "pose-rig-container";

    const updateView = () => {

      if( poseRigContainer.classList.contains( "hidden" ) )
        return;

      //update all the node positions
      //origin and legs already loaded
      const rig = currentLayer.rig;
      getTransform();
      let offset;
      for( const node of poseRigHandles ) {
        if( ! offset ) {
          const r = node.getClientRects()[ 0 ];
          offset = r.width * devicePixelRatio / 2;
        }
        const name = node.rigNodeName;
        let canvasX = rig[ name ].x, canvasY = rig[ name ].y;
        updateNodePosition( node, canvasX, canvasY, offset );
      }

    };

    UI.registerElement(
      poseRigContainer,
      {
        updateContext: () => {
          if( uiSettings.isActiveTool( "pose" ) ) {
            const layers = getSelectedOrBatchedLayers();
            const onePoseLayer = layers.length === 1 && layers[ 0 ].layerType === "pose";

            if( ! onePoseLayer ) {
              //uiSettings.setActiveTool( null );
              poseRigContainer.classList.add( "hidden" );
            }
            else if( onePoseLayer ) {
              poseRigContainer.classList.remove( "hidden" );
              if( layers[ 0 ] !== currentLayer )
                poseRigContainer.loadLayer( layers[ 0 ] );
            }
          }
          else poseRigContainer.classList.add( "hidden" );
        },
        updateView,
      }
    );
    underlayContainer.appendChild( poseRigContainer );

    let currentLayer,
      origin,
      xLeg, xLegLength, normalizedXLeg,
      yLeg, yLegLength, normalizedYLeg;

    poseRigContainer.loadLayer = layer => {

      //load our layer's coordinate space
      origin = { x:layer.topLeft[0], y:layer.topLeft[1] };
      xLeg = { x:layer.topRight[0] - origin.x, y: layer.topRight[1] - origin.y };
      xLegLength = Math.sqrt( xLeg.x**2 + xLeg.y**2 );
      normalizedXLeg = { x:xLeg.x/xLegLength, y:xLeg.y/xLegLength };
      yLeg = { x:layer.bottomLeft[0] - origin.x, y: layer.bottomLeft[1] - origin.y };
      yLegLength = Math.sqrt( yLeg.x**2 + yLeg.y**2 );
      normalizedYLeg = { x:yLeg.x/yLegLength, y:yLeg.y/yLegLength };

      currentLayer = layer;
      //do an initial update of all our node positions
      updateView();

    }

    const updateNodePosition = ( node, canvasX, canvasY, offset ) => {
      //cast our canvas points to global space
      const xLegScale = canvasX / currentLayer.w,
        yLegScale = canvasY / currentLayer.h;
      const globalPointX = origin.x + xLegScale * xLeg.x + yLegScale * yLeg.x,
        globalPointY = origin.y + xLegScale * xLeg.y + yLegScale * yLeg.y;

      //cast our global points to the screen's pixel space
      let [ screenX,screenY ] = transformPoint( [ globalPointX, globalPointY, 1 ] );
      screenX -= offset;
      screenY -= offset;

      //update our node's position
      node.x = screenX;
      node.y = screenY;
      node.style.left = screenX / devicePixelRatio + "px";
      node.style.top = screenY / devicePixelRatio + "px";
    }

    const updateRigData = ( node, _inverter, offset ) => {
      //cast our node point to global space
      const nodePoint = [ node.x + offset, node.y + offset, 1 ];

      mul3x1( _inverter, nodePoint, nodePoint );

      //cast global space to the layer's canvas space
      let x = nodePoint[ 0 ] - origin.x;
      let y = nodePoint[ 1 ] - origin.y;

      //project on normals
      let xProjection = x*normalizedXLeg.x + y*normalizedXLeg.y;
      let yProjection = x*normalizedYLeg.x + y*normalizedYLeg.y;

      //scale inside canvas
      let canvasX = xProjection * selectedLayer.w / xLegLength;
      let canvasY = yProjection * selectedLayer.h / yLegLength;

      //update the rig data
      const rigNode = currentLayer.rig[ node.rigNodeName ];
      rigNode.x = canvasX;
      rigNode.y = canvasY;

    }

    const captureRigData = () => {
      return JSON.parse( JSON.stringify( currentLayer.rig ) );
    }


    let showingHandles = true;
    const poseRigHandles = [];

    const addPoseRigHandle = ( screenX, screenY, colorStyle, name, parentName ) => {
      const poseRigHandle = document.createElement( "div" );
      poseRigHandle.classList.add( "pose-rig-handle", "pose-rig-name-"+name, "pose-rig-parent-name-" + parentName );
      poseRigHandle.style.left = screenX/devicePixelRatio + "px";
      poseRigHandle.style.top = screenY/devicePixelRatio + "px";
      poseRigHandle.style.backgroundColor = colorStyle;
      poseRigHandle.rigNodeName = name;
      poseRigHandle.rigNodeParentName = parentName;
      poseRigHandle.x = screenX;
      poseRigHandle.y = screenY;
      let formalName = name.split( "-" );
      formalName[0] = formalName[0].split();
      formalName[0][0] = formalName[0][0].toUpperCase();
      if( formalName[1] ) {
        formalName[1] = formalName[1].split();
        formalName[1][0] = formalName[1][0].toUpperCase();
      }
      formalName = formalName[0].join("") + ( formalName[1] ? ( " " + formalName[1].join("") ) : "" );

      let draggingNodes = [],
        startingRigData = null;
      UI.registerElement(
        poseRigHandle,
        {
          ondrag: ({ rect, start, current, ending, starting, element }) => {
            
            const currentX = current.x * devicePixelRatio,
              currentY = current.y * devicePixelRatio,
              startX = start.x * devicePixelRatio,
              startY = start.y * devicePixelRatio;

            if( starting ) {
              startingRigData = captureRigData();
              poseRigHandle.classList.remove( "hovering" );
              draggingNodes.length = 0;
              draggingNodes.push( poseRigHandle );
              if( uiSettings.toolsSettings.pose.moveChildren === true )
                draggingNodes.push( ...getChildHandles( name ) );
              for( const node of draggingNodes ) {
                node.startX = node.x;
                node.startY = node.y;
              }
            }
            if( ! starting ) {
              //get the screen->global space inversion
              _originMatrix[ 2 ] = -view.origin.x;
              _originMatrix[ 5 ] = -view.origin.y;
              _positionMatrix[ 2 ] = view.origin.x;
              _positionMatrix[ 5 ] = view.origin.y;

              mul3x3( viewMatrices.current , _originMatrix , _inverter );
              mul3x3( _inverter , viewMatrices.moving , _inverter );
              mul3x3( _inverter , _positionMatrix , _inverter );
              inv( _inverter , _inverter );

              for( const node of draggingNodes ) {
                node.x = node.startX + ( (currentX - startX)  ),
                node.y = node.startY + ( (currentY - startY)  );
                node.style.left = node.x/devicePixelRatio + "px";
                node.style.top = node.y/devicePixelRatio + "px";

                const offset = rect.width*devicePixelRatio/2;

                //update the rig data
                updateRigData( node, _inverter, offset );
              }

              //update the render
              renderLayerPose( currentLayer );
            }
            if( ending ) {
              const oldData = startingRigData;
              const newData = captureRigData();
              const historyEntry = {
                targetLayer: currentLayer,
                oldData,
                newData,
                undo: () => {
                  historyEntry.targetLayer.rig = oldData;
                  renderLayerPose( historyEntry.targetLayer );
                  if( uiSettings.activeTool === "pose" && selectedLayer === historyEntry.targetLayer )
                    document.querySelector( "#pose-rig-container" ).loadLayer( selectedLayer );
                },
                redo: () => {
                  historyEntry.targetLayer.rig = newData;
                  renderLayerPose( historyEntry.targetLayer );
                  if( uiSettings.activeTool === "pose" && selectedLayer === historyEntry.targetLayer )
                    document.querySelector( "#pose-rig-container" ).loadLayer( selectedLayer );
                }
              }
              recordHistoryEntry( historyEntry );
            }
          },
        },
        {
          tooltip: [ formalName, "below", "to-right-of-center" ]
        }
      )

      poseRigHandles.push( poseRigHandle );
      poseRigContainer.appendChild( poseRigHandle );
    }

    const getChildHandles = name => {
      const childHandles = [];
      for( const childHandle of poseRigHandles ) {
        if( childHandle.rigNodeParentName === name ) {
          childHandles.push( childHandle );
          childHandles.push( ...getChildHandles( childHandle.rigNodeName ) );
        }
      }
      return childHandles;
    }

    //add the nodes
    for( const node of Object.values( uiSettings.defaultPoseRig ) ) {
      const { name, color, x, y, parentLink } = node;
      const parentName = parentLink?.parentName || null;
      const [r,g,b] = color;
      addPoseRigHandle( x*window.innerWidth, y*window.innerHeight, `rgb(${r},${g},${b})`, name, parentName );
    }

    /*
    {
      const poseRigPointsArray = [0.521484375, 0.146484375, 1.0, 0.517578125, 0.2578125, 1.0, 0.447265625, 0.259765625, 1.0, 0.31640625, 0.3203125, 1.0, 0.19140625, 0.333984375, 1.0, 0.58984375, 0.259765625, 1.0, 0.703125, 0.322265625, 1.0, 0.814453125, 0.3359375, 1.0, 0.48046875, 0.48828125, 1.0, 0.47265625, 0.69140625, 1.0, 0.451171875, 0.89453125, 1.0, 0.57421875, 0.484375, 1.0, 0.5703125, 0.693359375, 1.0, 0.576171875, 0.896484375, 1.0, 0.498046875, 0.123046875, 1.0, 0.546875, 0.125, 1.0, 0.46484375, 0.142578125, 1.0, 0.578125, 0.142578125, 1.0];
      const poseRigPoints = [];
      const pointInfo = {
        0: [ "head", 255,0,0 ],
        "head-to-crown-left": [ 51,0,153 ],
        14: [ "crown-left", 170,0,255 ],
        "crown-left-to-ear-left": [ 102,0,153 ],
        16: [ "ear-left", 255,0,170 ],
        "head-to-crown-right": [ 153,0,153 ],
        15: [ "crown-right", 255,0,255 ],
        "crown-right-to-ear-right": [ 153,0,102 ],
        17: [ "ear-right", 255, 0, 85 ],
        "spine-to-head": [ 0,0,153 ],
  
        1: [ "spine", 255,85,0 ],
  
        "spine-to-shoulder-left": [ 153,0,0 ],
        2: [ "shoulder-left", 255,170,0 ],
        "shoulder-left-to-elbow-left": [ 153,102,0 ],
        3: [ "elbow-left", 255,255,0 ],
        "elbow-left-to-wrist-left": [ 153,153,0 ],
        4: [ "wrist-left", 170,255,0 ],
  
        "spine-to-shoulder-right": [ 153,51,0 ],
        5: [ "shoulder-right", 85,255,0 ],
        "shoulder-right-to-elbow-right": [ 102,153,0 ],
        6: [ "elbow-right", 0,255,0 ],
        "elbow-right-to-wrist-right": [ 51,153,0 ],
        7: [ "wrist-right", 0,255,85 ],
  
        "spine-to-hip-left": [ 0, 153, 0 ],
        8: [ "hip-left", 0,255,170 ],
        "hip-left-to-knee-left": [ 0,153,51 ],
        9: [ "knee-left", 0,255,255 ],
        "knee-left-to-ankle-left": [ 0,153,102 ],
        10: [ "ankle-left", 0,170,255 ],
  
        "spine-to-hip-right": [ 0,153,153 ],
        11: [ "hip-right", 0,85,255 ],
        "hip-right-to-knee-right": [ 0,102,153 ],
        12: [ "knee-right", 0,0,255 ],
        "knee-right-to-ankle-right": [ 0,1,153 ],
        13: [ "ankle-right", 85,0,255 ],
  
      }
      for( let i=0; i<poseRigPointsArray.length; i+=3 ) {
        poseRigPoints.push( { x:poseRigPointsArray[i+0], y:poseRigPointsArray[i+1], id: i/3 } );
      }
      for( const {x,y,id} of poseRigPoints ) {
        addPoseRigHandle( x*window.innerWidth, y*window.innerHeight, id );
      }
  
      //build the object
      let rigObject = {};
      for( let i=0; i<poseRigPointsArray.length; i+=3 ) {
        const x = poseRigPointsArray[ i + 0 ],
          y = poseRigPointsArray[ i + 1 ],
          id = i / 3;
        const [ name, r,g,b ] = pointInfo[ id ];
        let childLink = null;
        const linkToChildKey = Object.keys( pointInfo ).find( k => k.indexOf( name ) === 0 );
        if( linkToChildKey ) {
          const childName = linkToChildKey.replace( name + "-to-", "" );
          childLink = {
            linkName: linkToChildKey,
            childName,
            color: pointInfo[ linkToChildKey ]
          };
        }
        let parentLink = null;
        const linkFromParentKey = Object.keys( pointInfo ).find( k => k.indexOf( name ) > 0 );
        if( linkFromParentKey ) {
          const parentName = linkFromParentKey.replace( "-to-" + name, "" );
          parentLink = {
            linkName: linkFromParentKey,
            parentName,
            color: pointInfo[ linkFromParentKey ]
          }
        }
        rigObject[ name ] = {
          name, color: [ r,g,b ], x, y,
          childLink,
          parentLink
        }
      }
  
      console.log( JSON.stringify( rigObject ) );
  
    }
    */

    /* const handleUpdateLoop = t => {
      if( showingHandles === true ) requestAnimationFrame( handleUpdateLoop );
    } */

  }

  //the generative controls
  {

    //the generative controls row
    const generativeControlsRow = document.createElement( "div" );
    generativeControlsRow.classList.add( "hidden", "animated" );
    generativeControlsRow.id = "generative-controls-row";
    UI.registerElement(
      generativeControlsRow,
      {
        updateContext: () => {
          if( uiSettings.activeTool === "generate" ) {
            if( setupUIGenerativeControls.currentSelectedLayer !== selectedLayer ) {
              setupUIGenerativeControls( selectedLayer.generativeSettings.apiFlowName );
            }
            generativeControlsRow.classList.remove( "hidden" );
          }
          else generativeControlsRow.classList.add( "hidden" );
        }
      },
      {
        zIndex: 1000,
      }
    );
    uiContainer.appendChild( generativeControlsRow );

    //the controls (excluding img-drops) (setupUIGenerativeControls modifies this)
    {
      const controlsPanel = document.createElement( "div" );
      controlsPanel.classList.add( "flex-row" );
      controlsPanel.id = "generative-controls-panel";
      generativeControlsRow.appendChild( controlsPanel );
    }

    //the image-drops (setupUIGenerativeControls modifies this)
    {
      const imageInputsPanel = document.createElement( "div" );
      //imageInputsPanel.classList.add( "flex-row" );
      imageInputsPanel.id = "generative-controls-images-inputs-panel";
      generativeControlsRow.appendChild( imageInputsPanel );
    }

    //the apiflow selector button
    {
      const apiFlowSelectorButton = document.createElement( "div" );
      apiFlowSelectorButton.classList.add( "asset-button", "round-toggle", "on" );
      apiFlowSelectorButton.id = "api-flow-selector-button";
      apiFlowSelectorButton.appendChild( document.createTextNode( "API" ) );
      UI.registerElement(
        apiFlowSelectorButton,
        {
          onclick: () => {
            const assets = [];
            for( const apiFlow of apiFlows ) {
              //if( apiFlow.isDemo ) continue;
              //if( apiFlow.apiFlowType === "asset" ) continue;
              //if( apiFlow.apiFlowType === "generative-tool" ) continue;
              if( apiFlow.apiFlowType !== "generative" ) continue;
              apiFlow.name = apiFlow.apiFlowName;
              //const asset = { name: apiFlow.apiFlowName }
              assets.push( apiFlow );
            }
            const callback = asset => {
              selectedLayer.generativeSettings.apiFlowName = asset.name;
              setupUIGenerativeControls( asset.name );
            }
            openAssetBrowser( assets, callback, "APIFlows" );
          }
        },
        { tooltip: [ "Select APIFlow", "below", "to-right-of-center" ], zIndex:10000, },
      )
      generativeControlsRow.appendChild( apiFlowSelectorButton );
    }
    //the generate button
    {
      const generateButton = document.createElement( "div" );
      generateButton.classList.add( "animated" );
      const generateLabel = document.createElement( "div" );
      generateLabel.classList.add( "generate-label", "animated" );
      generateLabel.textContent = "GENERATE";
      generateButton.appendChild( generateLabel );
      generateButton.id = "generate-button";
      UI.registerElement(
        generateButton,
        {
          onclick: async () => {

            generateButton.classList.add( "pushed" );
            setTimeout( () => generateButton.classList.remove( "pushed" ), UI.animationMS );

            //get controlvalues
            let apiFlowName = setupUIGenerativeControls.currentApiFlowName;

            if( apiFlowName === null ) {
              UI.showOverlay.error( "Please select an API." );
              return;
            }

            const apiFlow = apiFlows.find( flow => flow.apiFlowName === apiFlowName );
            const controlValues = populateAPIFlowControls( apiFlow );
            //for any values not provided, executeAPICall will retain the default values encoded in those controls, including "static" controltypes

            //do the generation
            UI.showOverlay.generating();
            const result = await executeAPICall( apiFlowName, controlValues );
            UI.hideOverlay.generating();
            if( result === false ) {
              UI.showOverlay.error( 'Generation failed. Stuff to check:<ul style="font-size:0.825rem; text-align:left; margin:0; padding:1rem; padding-right:0;"><li>Are the generative controls right?</li><li>Are the image inputs connected?</li><li>Is Comfy/A1111 running?</li><li>Do you have all this API\'s nodes/extensions?</li><li>Do you have all your APIKeys configured right in settings?</li><li>If this is your custom APIFlow, check the dev tools for more info.</li></ul>' );
            } else {
              if( result[ "generated-image" ] ) {
                //Generation results can't be undone
                const image = result[ "generated-image" ];
                if( image.width !== selectedLayer.w || image.height !== selectedLayer.h )
                  cropLayerSizeAndRecordUndo( selectedLayer, image.width, image.height );
                selectedLayer.context.drawImage( result[ "generated-image" ], 0, 0 );
                const frame = makeLayerFrame( selectedLayer );
                selectedLayer.currentFrameIndex = selectedLayer.frames.push( frame ) - 1;
                frame.timeIndex = selectedLayer.currentFrameIndex;
                updateLayerFrame( selectedLayer, frame, true );
                flagLayerTextureChanged( selectedLayer, null, false );
              }
              else if( result[ "generated-images" ] ) {
                for( const image of result[ "generated-images" ] ) {
                  if( image.width !== selectedLayer.w || image.height !== selectedLayer.h )
                    cropLayerSizeAndRecordUndo( selectedLayer, image.width, image.height );
                  selectedLayer.context.drawImage( result[ "generated-image" ], 0, 0 );
                  const frame = makeLayerFrame( selectedLayer );
                  selectedLayer.currentFrameIndex = selectedLayer.frames.push( frame ) - 1;
                  frame.timeIndex = selectedLayer.currentFrameIndex;
                  updateLayerFrame( selectedLayer, frame, true );
                }
                flagLayerTextureChanged( selectedLayer, null, false );
              }
            }
          }
        },
        { tooltip: [ "Generate", "below", "to-left-of-center" ], zIndex:10000, },
      )
      generativeControlsRow.appendChild( generateButton );
    }

    //the settings controlpanel overlay
    {
      const settingsControlPanelOverlay = document.createElement( "div" );
      settingsControlPanelOverlay.classList.add( "overlay-background", "hidden", "real-input", "animated" );
      //settingsControlPanelOverlay.classList.add( "overlay-background", "real-input", "animated" );
      settingsControlPanelOverlay.id = "settings-controlpanel-overlay";

      const settingsKeyTrap = e => {
        if( e.code === "Escape" ) closeButton.onclick();
        if( e.code === "Enter" ) closeButton.onclick();
      }
      function enableSettingsKeyTrapping() {
        window.addEventListener( "keydown", settingsKeyTrap );
      }
      function disableSettingsKeyTrapping() {
        window.removeEventListener( "keydown", settingsKeyTrap );
      }

      settingsControlPanelOverlay.onapply = () => {};
      settingsControlPanelOverlay.show = () => {
        settingsControlPanelOverlay.classList.remove( "hidden" );
        controlPanel.focus();
        disableKeyTrapping();
        enableSettingsKeyTrapping();
        const apiKeysPanel = controlPanel.querySelector(".apikeys-panel");
        apiKeysPanel.classList.add( "blur" );
        apiKeysPanel.onclick = apiKeysPanel.removeBlur;
        apiKeysPanel.showApiKeys();
      };
      //back/close button
      const closeButton = document.createElement( "div" );
      closeButton.classList.add( "overlay-close-button", "overlay-element", "animated" );
      closeButton.onclick = () => {
        closeButton.classList.add( "pushed" );
        setTimeout( ()=>closeButton.classList.remove("pushed"), UI.animationMS );
        disableSettingsKeyTrapping();
        enableKeyTrapping();
        settingsControlPanelOverlay.classList.add( "hidden" );
      }
      closeButton.role = "button"; closeButton.tabIndex = "0";
      closeButton.onkeydown = e => { if( ["Enter","Space"].includes( e.code ) ) closeButton.onclick(); }
      settingsControlPanelOverlay.appendChild( closeButton );

      //controlpanel
      const controlPanel = document.createElement( "div" );
      controlPanel.classList.add( "overlay-controlpanel", "overlay-element", "animated" );

      //the apikeys panel
      {

        //the apikeys panel specialized undo functionality
        const apiKeyHistory = [], apiKeyFuture = [];
        function undoApiKey() {
          if( apiKeyHistory.length > 0 ) {
            const historyEntry = apiKeyHistory.pop();
            uiSettings.apiFlowVariables = JSON.parse( historyEntry.oldState );
            apiKeyFuture.push( historyEntry );
            redoApiKeyButton.classList.remove( "unavailable" );
            apiKeysPanel.showApiKeys();
          }
          if( apiKeyHistory.length === 0 ) {
            undoApiKeyButton.classList.add( "unavailable" );
          }
        }
        function redoApiKey() {
          if( apiKeyFuture.length > 0 ) {
            const historyEntry = apiKeyFuture.pop();
            uiSettings.apiFlowVariables = JSON.parse( historyEntry.newState );
            apiKeyHistory.push( historyEntry );
            undoApiKeyButton.classList.remove( "unavailable" );
            apiKeysPanel.showApiKeys();
          }
          if( apiKeyFuture.length === 0 ) {
            redoApiKeyButton.classList.add( "unavailable" );
          }
        }
        function recordApiKeyUndo( oldState, newState ) {
          const historyEntry = { oldState, newState };
          apiKeyHistory.push( historyEntry );
          undoApiKeyButton.classList.remove( "unavailable" );
          apiKeyFuture.length = 0;
          redoApiKeyButton.classList.add( "unavailable" );
          apiKeysPanel.showApiKeys();
        }


        const apiKeysPanelLabel = document.createElement( "div" );
        apiKeysPanelLabel.classList.add( "overlay-controlpanel-label" );
        apiKeysPanelLabel.textContent = "APIFlow Keys";
        controlPanel.appendChild( apiKeysPanelLabel );

        const redoApiKeyButton = document.createElement( "div" );
        redoApiKeyButton.classList.add( "round-toggle", "animated" );
        redoApiKeyButton.id = "redo-apikey-button";
        redoApiKeyButton.onclick = () => {
          if( apiKeyFuture.length === 0 ) return;
          redoApiKey();
          redoApiKeyButton.classList.add( "pushed" );
          setTimeout( ()=>redoApiKeyButton.classList.remove("pushed"), UI.animationMS );
        }
        apiKeysPanelLabel.appendChild( redoApiKeyButton );
        const undoApiKeyButton = document.createElement( "div" );
        undoApiKeyButton.classList.add( "round-toggle", "unavailable", "animated" );
        undoApiKeyButton.id = "undo-apikey-button";
        undoApiKeyButton.onclick = () => {
          if( apiKeyHistory.length === 0 ) return;
          undoApiKey();
          undoApiKeyButton.classList.add( "pushed" );
          setTimeout( ()=>undoApiKeyButton.classList.remove("pushed"), UI.animationMS );
        }
        apiKeysPanelLabel.appendChild( undoApiKeyButton );


        const apiKeysPanel = document.createElement( "div" );
        apiKeysPanel.classList.add( "apikeys-panel", "blur" );
        apiKeysPanel.removeBlur = () => {
          apiKeysPanel.classList.remove( "blur" );
          apiKeysPanel.onclick = undefined;
        }
        apiKeysPanel.onclick = apiKeysPanel.removeBlur;
        apiKeysPanel.showApiKeys = () => {
          //assuming we've just updated, persist
          conserveSettings();
          
          apiKeysPanel.innerHTML = "";
          //the add button
          {
            const addRow = document.createElement( "div" );
            addRow.classList.add( "apikey-row" );
            const addbutton = document.createElement( "div" );
            addbutton.classList.add( "apikey-row-button", "long", "dark" );
            addbutton.textContent = "+ Add New";
            addbutton.onclick = () => 
              UI.showOverlay.text({
                value:"Key Name",
                label: "New APIFlow Variable Key",
                onapply: newKey => {
                  const oldState = JSON.stringify(uiSettings.apiFlowVariables);
                  uiSettings.apiFlowVariables.unshift({
                    "key": newKey,
                    "value": "",
                    "permissions": []
                  });
                  const newState = JSON.stringify(uiSettings.apiFlowVariables);
                  recordApiKeyUndo( oldState, newState ); //calls redisplay
                }
              } );
            addRow.appendChild( addbutton );
            apiKeysPanel.appendChild( addRow );
          }
          //the api key rows
          for( let i=0; i<uiSettings.apiFlowVariables.length; i++ ) {
            const apiFlowVariable = uiSettings.apiFlowVariables[ i ];
            const {key,value,permissions} = apiFlowVariable;
            const row = document.createElement( "div" );
            row.classList.add( "apikey-row" );

            const keyButton = document.createElement( "div" );
            keyButton.classList.add( "apikey-row-button" );
            keyButton.textContent = "✎ " + key;
            keyButton.onclick = () => 
              UI.showOverlay.text({
                value:key,
                label: "APIFlow Variable Key",
                onapply: newKey => {
                  const oldState = JSON.stringify(uiSettings.apiFlowVariables);
                  apiFlowVariable.key = newKey;
                  const newState = JSON.stringify(uiSettings.apiFlowVariables);
                  recordApiKeyUndo( oldState, newState ); //calls redisplay
                }
              } );

            row.appendChild( keyButton );
            const valueButton = document.createElement( "div" );
            valueButton.classList.add( "apikey-row-button" );
            valueButton.textContent = "✎ " + value;
            valueButton.onclick = () => 
              UI.showOverlay.text({
                value:value,
                label: "APIFlow Variable Value",
                onapply: newValue => {
                  const oldState = JSON.stringify(uiSettings.apiFlowVariables);
                  apiFlowVariable.value = newValue;
                  const newState = JSON.stringify(uiSettings.apiFlowVariables);
                  recordApiKeyUndo( oldState, newState ); //calls redisplay
                }
              } );

            row.appendChild( valueButton );
            const permissionsButton = document.createElement( "div" );
            permissionsButton.classList.add( "apikey-row-button", "dark" );
            permissionsButton.textContent = "↓ Permissions";
            permissionsButton.onclick = () => {
              const apiFlowNames = apiFlows.map( f => ({name:f.apiFlowName}) );
              const activePermissions = apiFlowNames.filter( f => permissions.includes(f.name) );
              openAssetBrowser( apiFlowNames,
                modifiedPermissions => {
                  //check for changes so we don't pollute our undo history
                  let changeFound = false;
                  for( const permission of modifiedPermissions ) {
                    if( ! activePermissions.find( p => p.name === permission.name ) ) {
                      changeFound = true;
                      break;
                    }
                  }
                  if( ! changeFound )
                    for( const permission of activePermissions ) {
                      if( ! modifiedPermissions.find( p => p.name === permission.name ) ) {
                        changeFound = true;
                        break;
                      }
                    }
                  if( changeFound === false ) {
                    return;
                  }
                  const oldState = JSON.stringify(uiSettings.apiFlowVariables);
                  apiFlowVariable.permissions = modifiedPermissions.map(p=>p.name);
                  const newState = JSON.stringify(uiSettings.apiFlowVariables);
                  //calling redisplay to bind new permissions array to this function
                  recordApiKeyUndo( oldState, newState );
                },
                null, activePermissions );
            }
            row.appendChild( permissionsButton );

            const deleteButton = document.createElement( "div" );
            deleteButton.classList.add( "apikey-row-button", "dark", "stub", "apikey-row-delete-icon" );
            deleteButton.onclick = () => {
              const oldState = JSON.stringify(uiSettings.apiFlowVariables);
              uiSettings.apiFlowVariables.splice( i, 1 );
              const newState = JSON.stringify(uiSettings.apiFlowVariables);
              recordApiKeyUndo( oldState, newState ); //calls redisplay, rebinds all indices for delete
            };
            row.appendChild( deleteButton );

            apiKeysPanel.appendChild( row );
          }

        }
        controlPanel.appendChild( apiKeysPanel );
      }

      settingsControlPanelOverlay.appendChild( controlPanel );

      overlayContainer.appendChild( settingsControlPanelOverlay );
    }

    //the text-input overlay
    {
      //full-screen overlay
      const textInputOverlay = document.createElement( "div" );
      textInputOverlay.classList.add( "overlay-background", "hidden", "real-input", "animated" );
      textInputOverlay.id = "multiline-text-input-overlay";
      textInputOverlay.onapply = () => {};
      textInputOverlay.setText = text => { textInput.value = text };
      textInputOverlay.setLabel = label => { textInputLabel.textContent = label };
      textInputOverlay.show = () => {
        textInputOverlay.classList.remove( "hidden" );
        textInput.focus();
        disableKeyTrapping();
      };
      //back/close button
      const closeButton = document.createElement( "div" );
      closeButton.classList.add( "overlay-close-button", "overlay-element", "animated" );
      closeButton.onclick = () => {
        closeButton.classList.add( "pushed" );
        setTimeout( ()=>closeButton.classList.remove("pushed"), UI.animationMS );
        enableKeyTrapping();
        textInputOverlay.classList.add( "hidden" );
      }
      closeButton.role = "button"; closeButton.tabIndex = "0";
      closeButton.onkeydown = e => { if( ["Enter","Space"].includes( e.code ) ) closeButton.onclick(); }
      textInputOverlay.appendChild( closeButton );
      //label
      const textInputLabel = document.createElement( "div" );
      textInputLabel.classList.add( "overlay-input-label", "overlay-element", "animated" );
      textInputLabel.textContent = "";
      textInputOverlay.appendChild( textInputLabel );
      //text input
      const textInput = document.createElement( "textarea" );
      textInput.classList.add( "overlay-text-input", "overlay-element", "animated" );
      textInput.onkeydown = e => {
        if( e.code === "Escape" ) closeButton.onclick();
        if( e.code === "Enter" && e.ctrlKey === true ) applyButton.onclick();
      }
      textInputOverlay.appendChild( textInput );
      //the apply/save button
      const applyButton = document.createElement( "div" );
      applyButton.classList.add( "overlay-apply-button", "overlay-element", "animated" );
      applyButton.onclick = () => {
        applyButton.classList.add( "pushed" );
        setTimeout( ()=>applyButton.classList.remove("pushed"), UI.animationMS );
        enableKeyTrapping();
        textInputOverlay.classList.add( "hidden" );
        textInputOverlay.onapply( textInput.value );
      }
      applyButton.role = "button"; applyButton.tabIndex = "0";
      applyButton.onkeydown = e => { if( ["Enter","Space"].includes( e.code ) ) applyButton.onclick(); }
      textInputOverlay.appendChild( applyButton );

      overlayContainer.appendChild( textInputOverlay );
    }

    //the number-input overlay
    {
      //full-screen overlay
      const numberInputOverlay = document.createElement( "div" );
      numberInputOverlay.classList.add( "overlay-background", "hidden", "real-input", "animated" );
      numberInputOverlay.id = "number-input-overlay";
      numberInputOverlay.setLabel = label => { numberInputLabel.textContent = label };
      numberInputOverlay.onapply = () => {};
      numberInputOverlay.show = () => {
        numberInputOverlay.classList.remove( "hidden" );
        numberInput.focus();
        disableKeyTrapping();
      };
      //back/close button
      const closeButton = document.createElement( "div" );
      closeButton.classList.add( "overlay-close-button", "overlay-element", "animated" );
      closeButton.onclick = () => {
        closeButton.classList.add( "pushed" );
        setTimeout( ()=>closeButton.classList.remove("pushed"), UI.animationMS );
        enableKeyTrapping();
        numberInputOverlay.classList.add( "hidden" );
      }
      closeButton.role = "button"; closeButton.tabIndex = "0";
      closeButton.onkeydown = e => {
        if( ["Enter","Space"].includes( e.code ) ) closeButton.onclick();
      }
      numberInputOverlay.appendChild( closeButton );
      //label
      const numberInputLabel = document.createElement( "div" );
      numberInputLabel.classList.add( "overlay-input-label", "overlay-element", "animated" );
      numberInputLabel.textContent = "";
      numberInputOverlay.appendChild( numberInputLabel );
      //text input
      const numberInput = document.createElement( "input" );
      numberInput.type = "number";
      numberInput.min = 0;
      numberInput.max = 1;
      numberInput.step = 0.01;
      numberInput.value = 0.5;
      numberInput.onkeydown = e => {
        if( e.code === "Escape" ) closeButton.onclick();
        if( e.code === "Enter" || e.code === "NumpadEnter" ) applyButton.onclick();
      }
      numberInput.classList.add( "overlay-number-input", "overlay-element", "animated" );
      numberInputOverlay.appendChild( numberInput );
      //the apply/save button
      const applyButton = document.createElement( "div" );
      applyButton.classList.add( "overlay-apply-button", "overlay-element", "animated" );
      applyButton.onclick = () => {
        applyButton.classList.add( "pushed" );
        setTimeout( ()=>applyButton.classList.remove("pushed"), UI.animationMS );
        enableKeyTrapping();
        numberInputOverlay.classList.add( "hidden" );
        numberInputOverlay.onapply( numberInput.value );
      }
      applyButton.role = "button"; applyButton.tabIndex = "0";
      applyButton.onkeydown = e => { if( ["Enter","Space"].includes( e.code ) ) applyButton.onclick(); }
      numberInputOverlay.appendChild( applyButton );

      overlayContainer.appendChild( numberInputOverlay );
    }

    //the project-filename-save overlay
    {
      //full-screen overlay
      const filenameSaveOverlay = document.createElement( "div" );
      filenameSaveOverlay.classList.add( "overlay-background", "hidden", "real-input", "animated" );
      filenameSaveOverlay.id = "filename-input-overlay";
      filenameSaveOverlay.onapply = () => {
        let filename = document.querySelector( ".overlay-filename-input" ).value;
        filename = filename.replace( /[^\w\d_ !.()[\]{}+-]/gmi, "" );
        document.querySelector( ".overlay-filename-input" ).value = filename || "[automatic]";
        uiSettings.filename = filename || "[automatic]";
        saveJSON();
      };
      filenameSaveOverlay.show = () => {
        filenameSaveOverlay.classList.remove( "hidden" );
        filenameInput.focus();
        disableKeyTrapping();
      };
      //label
      {
        const label = document.createElement( "div" );
        label.classList.add( "overlay-input-label", "overlay-element", "animated" );
        label.textContent = "Save Filename";
        filenameSaveOverlay.appendChild( label );
      }
      //back/close button
      const closeButton = document.createElement( "div" );
      closeButton.classList.add( "overlay-close-button", "overlay-element", "animated" );
      closeButton.onclick = () => {
        closeButton.classList.add( "pushed" );
        setTimeout( ()=>closeButton.classList.remove("pushed"), UI.animationMS );
        enableKeyTrapping();
        filenameSaveOverlay.classList.add( "hidden" );
      }
      closeButton.role = "button"; closeButton.tabIndex = "0";
      closeButton.onkeydown = e => {
        if( ["Enter","Space"].includes( e.code ) ) closeButton.onclick();
      }
      filenameSaveOverlay.appendChild( closeButton );
      //text input
      const filenameInput = document.createElement( "input" );
      filenameInput.type = "text";
      filenameInput.onkeydown = e => {
        if( e.code === "Escape" ) closeButton.onclick();
        if( e.code === "Enter" || e.code === "NumpadEnter" ) applyButton.onclick();
      }
      filenameInput.classList.add( "overlay-filename-input", "overlay-element", "animated" );
      filenameSaveOverlay.appendChild( filenameInput );
      //the apply/save button
      const applyButton = document.createElement( "div" );
      applyButton.classList.add( "overlay-apply-button", "overlay-element", "animated" );
      applyButton.onclick = () => {
        applyButton.classList.add( "pushed" );
        setTimeout( ()=>applyButton.classList.remove("pushed"), UI.animationMS );
        enableKeyTrapping();
        filenameSaveOverlay.classList.add( "hidden" );
        filenameSaveOverlay.onapply( filenameInput.value );
      }
      applyButton.role = "button"; applyButton.tabIndex = "0";
      applyButton.onkeydown = e => { if( ["Enter","Space"].includes( e.code ) ) applyButton.onclick(); }
      filenameSaveOverlay.appendChild( applyButton );

      overlayContainer.appendChild( filenameSaveOverlay );
    }

    //the generating overlay
    {
      //full-screen overlay
      const generatingOverlay = document.createElement( "div" );
      generatingOverlay.classList.add( "overlay-background", "hidden", "real-input", "animated" );
      //generatingOverlay.classList.add( "overlay-background", "real-input", "animated" );
      generatingOverlay.id = "generating-overlay";
      generatingOverlay.show = () => {
        generatingOverlay.classList.remove( "hidden" );
        looping = true;
        requestAnimationFrame( generatingAnimationLoop );
        disableKeyTrapping();
      };
      generatingOverlay.hide = () => {
        generatingOverlay.classList.add( "hidden" );
        looping = false;
        enableKeyTrapping();
      };
      const generatingCanvas = document.createElement( "canvas" );
      generatingCanvas.classList.add( "animated" );
      generatingCanvas.id = "generating-canvas";
      generatingOverlay.appendChild( generatingCanvas );
      generatingCanvas.width = 512;
      generatingCanvas.height = 512;
      generatingCanvas.style = `
        width:${generatingCanvas.width/devicePixelRatio}px;
        height:${generatingCanvas.height/devicePixelRatio}px;
        left:calc( 50vw - ${0.5*generatingCanvas.width/devicePixelRatio}px );
        top: max( 1rem, calc( 25vh - ${0.5*generatingCanvas.height/devicePixelRatio}px ) );
      `;
      const ctx = generatingCanvas.getContext( "2d" );

      const imgs = {tophat:null,wand:null,star:null};
      let imagesLoaded = 0;
      for( const src in imgs ) {
        imgs[ src ] = new Image();
        imgs[ src ].onload = ()=>{if(++imagesLoaded===3)imagesLoaded=true;}
        imgs[ src ].src = "icon/" + src + ".png";
      }

      overlayContainer.appendChild( generatingOverlay );

      const stars = [];
      const star = {
        count: 5,
        lastSpawned: -1,
        spawnTime: 600,
      }
      const spawnStar = ( t ) => {
        let fx = 0.5 - Math.random() * 0.25 + 0.125;
        let fy = 0.55;
        const x = fx * generatingCanvas.width,
          y = fy * generatingCanvas.height;
        let scale = 0.125 + Math.random() * 0.25;
        let rotate = Math.random() * Math.PI * 2;
        stars.push({
          x, y,
          vy: 0.00025 + Math.random() * 0.0005,
          scale,
          rotate,
          t
        })
        star.lastSpawned = t;
      }

      let looping = false;
      const generatingAnimationLoop = t => {

        if( looping ) requestAnimationFrame( generatingAnimationLoop );

        const w = generatingCanvas.width,
          h = generatingCanvas.height;

        if( imagesLoaded === true ) {
          ctx.clearRect( 0,0,w,h );
          ctx.save();
          ctx.translate( w/2,h/2 );
          ctx.scale( 0.25,0.25 );
          //draw tophat
          {
            let rotation = 0;
            {
              const restTime = 5000,
                rotateTime = 300;
              if( t % (restTime+rotateTime) > restTime ) {
                let f = (( t % (restTime+rotateTime) ) - restTime) / rotateTime;
                rotation = Math.sin( f * Math.PI * 2 ) * 0.07;
              }
            }
            let stretch = 0;
            {
              const stretchTime = 4000;
              const tf = ( t % stretchTime ) / stretchTime;
              const sawPhase = Math.abs( tf * 2 - 1 );
              stretch = Math.pow( sawPhase * 2 - 1, 2 ) * 0.05;
            }
            ctx.save();
            ctx.translate( 0, imgs.tophat.height );
            ctx.scale( 1 + stretch, 1 - stretch );
            ctx.rotate( rotation );
            ctx.drawImage( imgs.tophat, -imgs.tophat.width/2, -imgs.tophat.height );
            ctx.restore();
          }
          //draw wand
          {
            let dx, dy;
            {
              const orbitTime = 16000;
              const orbitRadius = imgs.wand.width/8;
              const tf = ( t % orbitTime ) / orbitTime;
              const a = tf * Math.PI * 2;
              dx = Math.cos( a ) * orbitRadius;
              dy = Math.sin( a ) * orbitRadius;
            }
            let rotation;
            {
              const rotateTime = 7000;
              const tf = ( t % rotateTime ) / rotateTime;
              const a = tf * Math.PI * 2;
              rotation = Math.sin( a ) * 0.1;
            }
            ctx.save();
            ctx.translate( -imgs.tophat.width/2, -imgs.tophat.height*0.7 );
            ctx.translate( dx, dy );
            ctx.rotate( rotation );
            ctx.drawImage( imgs.wand, -imgs.wand.width/2, -imgs.wand.height/2 );
            ctx.restore();
          }
          ctx.restore();
          //draw stars
          {
            if( stars.length < star.count && (t-star.lastSpawned) > star.spawnTime ) spawnStar( t );
            for( let i=stars.length-1; i>=0; i-- ) {
              const s = stars[ i ];
              const dt = t - s.t;
              s.y -= s.vy * dt;
              ctx.save();
              ctx.translate( s.x, s.y );
              ctx.scale( s.scale, s.scale );
              ctx.rotate( s.rotate );
              let rotation = 0, scale = 1;
              if( dt < 3000 ) {
                const ft = dt / 3000;
                const f = ( 1 - ft ) ** 2;
                //rotation -= f * Math.PI * 12;
                ctx.filter = `blur(${f*20}px)`;
                scale = ft;
              }
              {
                const ft = ( dt % 10000 ) / 10000;
                rotation -= ( 1 - ft ) * Math.PI * 2;
              }
              ctx.scale( scale, scale );
              ctx.rotate( rotation );
              ctx.globalAlpha = Math.min( 1, Math.max( 0, (s.y - imgs.star.height*s.scale ) / (h*0.2) ) );
              ctx.drawImage( imgs.star, -imgs.star.width/2, -imgs.star.height/2 );
              ctx.restore();
              if( (s.y + s.scale*scale*imgs.star.width*1.1) < 0 )
                stars.splice( i, 1 );
            }
          }
        }

      }
      
    }

    //the error notification overlay
    {
      //full-screen overlay
      const errorNotificationOverlay = document.createElement( "div" );
      errorNotificationOverlay.classList.add( "overlay-background", "hidden", "real-input", "animated" );
      errorNotificationOverlay.id = "error-notification-overlay";
      errorNotificationOverlay.show = () => {
        errorNotificationOverlay.classList.remove( "hidden" );
        disableKeyTrapping();
      };
      //back/close button
      const closeButton = document.createElement( "div" );
      closeButton.classList.add( "overlay-close-button", "overlay-element", "animated" );
      closeButton.onclick = () => {
        closeButton.classList.add( "pushed" );
        setTimeout( ()=>closeButton.classList.remove("pushed"), UI.animationMS );
        enableKeyTrapping();
        errorNotificationOverlay.classList.add( "hidden" );
      }
      closeButton.role = "button"; closeButton.tabIndex = "0";
      closeButton.onkeydown = e => { if( ["Enter","Space"].includes( e.code ) ) closeButton.onclick(); }
      errorNotificationOverlay.appendChild( closeButton );
      //text input
      const errorText = document.createElement( "div" );
      errorText.textContent = "Error.";
      errorText.classList.add( "overlay-error-notification", "overlay-element", "animated" );
      errorNotificationOverlay.appendChild( errorText );
      //the accept button
      const acceptButton = document.createElement( "div" );
      acceptButton.classList.add( "overlay-accept-button", "overlay-element", "animated" );
      acceptButton.onclick = () => {
        acceptButton.classList.add( "pushed" );
        setTimeout( ()=>acceptButton.classList.remove("pushed"), UI.animationMS );
        enableKeyTrapping();
        errorNotificationOverlay.classList.add( "hidden" );
      }
      acceptButton.role = "button"; acceptButton.tabIndex = "0";
      acceptButton.onkeydown = e => { if( ["Enter","Space"].includes( e.code ) ) acceptButton.onclick(); }
      errorNotificationOverlay.appendChild( acceptButton );

      overlayContainer.appendChild( errorNotificationOverlay );
    }

  }

  //the filter controls
  {
    
    //the filters controls row
    const filtersControlsRow = document.createElement( "div" );
    filtersControlsRow.classList.add( "hidden", "animated" );
    filtersControlsRow.id = "filters-controls-row";
    UI.registerElement(
      filtersControlsRow,
      {
        updateContext: () => {
          if( uiSettings.activeTool === "generate" ) filtersControlsRow.classList.remove( "hidden" );
          else filtersControlsRow.classList.add( "hidden" );
        }
      },
      {
        zIndex: 1000,
      }
    );
    uiContainer.appendChild( filtersControlsRow );

    //the controls (excluding img-drops) (setupUIFiltersControls modifies this)
    {
      const controlsPanel = document.createElement( "div" );
      controlsPanel.classList.add( "flex-row" );
      controlsPanel.id = "filters-controls-panel";
      filtersControlsRow.appendChild( controlsPanel );
    }

  }

  //the home row buttons
  {
    const homeRow = document.createElement( "div" );
    homeRow.classList.add( "flex-row" );
    homeRow.id = "home-row";
    uiContainer.appendChild( homeRow );
    
    //the fullscreen button
    {
      const fullscreenButton = document.createElement( "div" );
      fullscreenButton.classList.add( "round-toggle", "home-row-enter-fullscreen-button" );
      if( document.fullscreenElement ) fullscreenButton.classList.add( "fullscreen" );
      homeRow.appendChild( fullscreenButton );
      UI.registerElement(
        fullscreenButton,
        {
          onclick: () => {
            if( document.fullscreenElement ) document.exitFullscreen?.();
            else main.requestFullscreen();
          },
          updateContext: () => {
            if( document.fullscreenElement ) fullscreenButton.classList.add( "fullscreen", "on" );
            else fullscreenButton.classList.remove( "fullscreen", "on" );
          },
        },
        { tooltip: [ "Enter/Exit Fullscreen", "below", "to-right-of-center" ] },
      )
    }
    //the file button
    {
      const fileButton = document.createElement( "div" );
      fileButton.classList.add( "round-toggle", "home-row-file-button", "animated" );
      homeRow.appendChild( fileButton );
      UI.registerElement(
        fileButton, {
          onclick: () => {
            if( UI.context.has( "add-file-panel-visible" ) ) {
              UI.deleteContext( "add-file-panel-visible" );
            } else {
              UI.addContext( "add-file-panel-visible" );
            }
            fileButton.classList.add( "pushed" );
            setTimeout( () => fileButton.classList.remove( "pushed" ), UI.animationMS );
          },
          updateContext: context => {
            if( context.has( "add-file-panel-visible" ) ) {
              fileButton.classList.add( "on" );
            } else {
              fileButton.classList.remove( "on" );
            }
          }
        },
        { tooltip: [ "File", "below", "to-right-of-center" ], zIndex:2000, },
      );
      
    //the file hovering panel
    {
      const filePanel = document.createElement( "div" );
      filePanel.classList.add( "animated" );
      filePanel.id = "file-panel";
      fileButton.appendChild( filePanel );

      //add the stylized summon marker arrow to the top-left
      const summonMarker = document.createElement( "div" );
      summonMarker.classList.add( "summon-marker" );
      filePanel.appendChild( summonMarker );

      UI.registerElement( filePanel, {
        onclickout: () => {
          UI.deleteContext( "add-file-panel-visible" );
        },
        updateContext: context => {
          if( context.has( "add-file-panel-visible" ) ) filePanel.classList.remove( "hidden" );
          else filePanel.classList.add( "hidden" );
        },
      }, { zIndex: 10000 } );

      {
        //add the project save button
        const projectSaveButton = filePanel.appendChild( document.createElement( "div" ) );
        projectSaveButton.classList.add( "rounded-line-button", "animated" );
        projectSaveButton.appendChild( new Image() ).src = "icon/save.png";
        projectSaveButton.appendChild( document.createElement("span") ).textContent = "Save Project";
        UI.registerElement( projectSaveButton, {
          onclick: () => {
            projectSaveButton.classList.add( "pushed" );
            setTimeout( () => projectSaveButton.classList.remove( "pushed" ), UI.animationMS );
            UI.showOverlay.save()
            UI.deleteContext( "add-file-panel-visible" );
          },
          updateContext: context => {
            if( context.has( "add-file-panel-visible" ) ) projectSaveButton.uiActive = true;
            else projectSaveButton.uiActive = false;
          }
        }, { 
          tooltip: [ "Save Project", "to-right", "vertical-center" ],
          zIndex: 11000
        } );
      }

      //add a spacer
      filePanel.appendChild( document.createElement( "div" ) ).className = "spacer";

      {
        //add the project load button
        const projectLoadButton = filePanel.appendChild( document.createElement( "div" ) );
        projectLoadButton.classList.add( "rounded-line-button", "animated" );
        projectLoadButton.appendChild( new Image() ).src = "icon/open.png";
        projectLoadButton.appendChild( document.createElement("span") ).textContent = "Open Project";
        UI.registerElement( projectLoadButton, {
          onclick: () => {
            projectLoadButton.classList.add( "pushed" );
            setTimeout( () => projectLoadButton.classList.remove( "pushed" ), UI.animationMS );
            loadJSON()
            UI.deleteContext( "add-file-panel-visible" );
          },
          updateContext: context => {
            if( context.has( "add-file-panel-visible" ) ) projectLoadButton.uiActive = true;
            else projectLoadButton.uiActive = false;
          }
        }, { 
          tooltip: [ "Load Project", "to-right", "vertical-center" ],
          zIndex: 11000
        } );
      }

      //add a spacer
      filePanel.appendChild( document.createElement( "div" ) ).className = "spacer";

      {
        //add the export image button
        const exportImageButton = filePanel.appendChild( document.createElement( "div" ) );
        exportImageButton.classList.add( "rounded-line-button", "animated" );
        exportImageButton.appendChild( new Image() ).src = "icon/export-image.png";
        exportImageButton.appendChild( document.createElement("span") ).textContent = "Export Image";
        UI.registerElement( exportImageButton, {
          onclick: () => {
            exportImageButton.classList.add( "pushed" );
            setTimeout( () => exportImageButton.classList.remove( "pushed" ), UI.animationMS );
            exportPNG()
            UI.deleteContext( "add-file-panel-visible" );
          },
          updateContext: context => {
            if( context.has( "add-file-panel-visible" ) ) exportImageButton.uiActive = true;
            else exportImageButton.uiActive = false;
          }
        }, { 
          tooltip: [ "Export Image", "to-right", "vertical-center" ],
          zIndex: 11000
        } );
      }

    }

    }
    //the settings button
    {
      const settingsButton = document.createElement( "div" );
      settingsButton.classList.add( "round-toggle", "home-row-settings-button", "animated" );
      homeRow.appendChild( settingsButton );
      UI.registerElement(
        settingsButton, { onclick: () => UI.showOverlay.controlPanel() },
        { tooltip: [ "Settings", "below", "to-right-of-center" ], zIndex:2000, },
      );
    }
  }


  //the console
  const debugInfoElement = uiContainer.appendChild( document.createElement( "div" ) );
  debugInfoElement.id = "console";

  //the generation history AKA framesline
  {
    //only one layer influences at a time
    //it's a row of dots
    //one selected dot has a marquee with options
    const framesline = document.createElement( "div" );
    framesline.id = "framesline";
  }

  //the timeline
  {
    //duplicate of full layers stack???
    //isn't it just one scrolling line with droppable cell targets?
    const timeline = document.createElement( "div" );
    timeline.id = "timeline";
  }

  //undo/redo
  {
    const bottomLeftRow = document.createElement( "div" );
    bottomLeftRow.classList.add( "flex-row" );
    bottomLeftRow.id = "bottom-left-row";
    uiContainer.appendChild( bottomLeftRow );
    //undo button
    {
      const undoButton = document.createElement( "div" );
      undoButton.classList.add( "round-toggle", "unavailable", "animated" );
      undoButton.id = "undo-button";
      UI.registerElement(
        undoButton,
        {
          onclick: undo,
          updateContext: context => {
            if( context.has( "undo-available" ) ) {
              undoButton.classList.add( "on" );
              undoButton.classList.remove( "unavailable" );
            }
            else {
              undoButton.classList.remove( "on" );
              undoButton.classList.add( "unavailable" );
            }
          }
        },
        { tooltip: [ "Undo", "above", "to-right-of-center" ] }
      );
      bottomLeftRow.appendChild( undoButton );
    }
    //redo button
    {
      const redoButton = document.createElement( "div" );
      redoButton.classList.add( "round-toggle", "unavailable", "animated" );
      redoButton.id = "redo-button";
      UI.registerElement(
        redoButton,
        {
          onclick: redo,
          updateContext: context => {
            if( context.has( "redo-available" ) ) {
              redoButton.classList.add( "on" );
              redoButton.classList.remove( "unavailable" );
            }
            else {
              redoButton.classList.remove( "on" );
              redoButton.classList.add( "unavailable" );
            }
          }
        },
        { tooltip: [ "Redo", "above", "to-right-of-center" ] }
      );
      bottomLeftRow.appendChild( redoButton );
    }
    //gen history button
    {
      const genHistoryButton = document.createElement( "div" );
      genHistoryButton.classList.add( "round-toggle", "unavailable", "unimplemented", "animated" );
      genHistoryButton.id = "gen-history-button";
      UI.registerElement(
        genHistoryButton,
        {
          onclick: ()=>{
            if( animationTimelineButton.classList.contains( "unimplemented" ) ) return;
            const framesline = document.querySelector( "#framesline" )
            if( framesline.classList.contains( "hidden" ) ) {
              framesline.remove( "hidden" );
              UI.addContext( "generation-history-visible" );
            }
            else {
              framesline.add( "hidden" );
              UI.deleteContext( "generation-history-visible" );
            }},
          updateContext: context => {
            if( genHistoryButton.classList.contains( "unimplemented" ) ) {
              genHistoryButton.classList.add( "unavailable" );
              genHistoryButton.classList.remove( "on" );
              genHistoryButton.querySelector(".tooltip" ).textContent = "!Unimplemented! Generation History" + ((selectedLayer?.layerType==="generative") ? "" : " [Select generative layer to view]");
              return;
            }

            if( selectedLayer?.layerType === "generative" ) {
              genHistoryButton.classList.remove( "unavailable" );
              if( context.has( "generation-history-visible" ) )
                genHistoryButton.classList.add( "on" );
              else genHistoryButton.classList.remove( "on" );
            }
            else {
              genHistoryButton.classList.remove( "on" );
              genHistoryButton.classList.add( "unavailable" );
            }
          }
        },
        { tooltip: [ "!Unimplemented! Generation History", "above", "to-right-of-center" ] }
      );
      bottomLeftRow.appendChild( genHistoryButton );
    }
    //animation timeline button
    {
      const animationTimelineButton = document.createElement( "div" );
      animationTimelineButton.classList.add( "round-toggle", "unavailable", "unimplemented", "animated" );
      animationTimelineButton.id = "animation-timeline-button";
      UI.registerElement(
        animationTimelineButton,
        {
          onclick: ()=>{
            if( animationTimelineButton.classList.contains( "unimplemented" ) ) return;
            const timeline = document.querySelector( "#timeline" )
            if( timeline.classList.contains( "hidden" ) ) {
              timeline.remove( "hidden" );
              UI.addContext( "animation-timeline-visible" );
            }
            else {
              timeline.add( "hidden" );
              UI.deleteContext( "animation-timeline-visible" );
            }
          },
          updateContext: context => {
            if( animationTimelineButton.classList.contains( "unimplemented" ) ) {
              animationTimelineButton.classList.add( "unavailable" );
              animationTimelineButton.classList.remove( "on" );
              animationTimelineButton.querySelector(".tooltip" ).textContent = "!Unimplemented! Animation Timeline";
              return;
            }
            animationTimelineButton.classList.remove( "unavailable" );
            if( context.has( "animation-timeline-visible" ) )
              animationTimelineButton.classList.add( "on" );
            else animationTimelineButton.classList.remove( "on" );
          }
        },
        { tooltip: [ "!Unimplemented! Animation Timeline", "above", "to-right-of-center" ] }
      );
      bottomLeftRow.appendChild( animationTimelineButton );
    }
    //canvas reset button
    {
      const canvasZoomRotateResetButton = document.createElement( "div" );
      canvasZoomRotateResetButton.classList.add( "round-toggle", "animated" );
      canvasZoomRotateResetButton.id = "canvas-zoom-rotate-reset-button";
      const canvasZoomRotateReset = () => {
        viewMatrices.current[0] = 1; viewMatrices.current[1] = 0; viewMatrices.current[2] = 0;
        viewMatrices.current[3] = 0; viewMatrices.current[4] = 1; viewMatrices.current[5] = 0;
        UI.updateView();
      }
      UI.registerElement(
        canvasZoomRotateResetButton,
        {
          onclick: canvasZoomRotateReset,
        },
        {
          tooltip: [ "Reset View Zoom/Rotate", "above", "to-right-of-center" ],
          bindings: {
            "Reset View Zoom/Rotate": canvasZoomRotateReset
          }
        }
      );
      bottomLeftRow.appendChild( canvasZoomRotateResetButton );
    }
    //canvas rotate lock button
    {
      const canvasRotateLockButton = document.createElement( "div" );
      canvasRotateLockButton.classList.add( "round-toggle", "animated" );
      canvasRotateLockButton.id = "canvas-rotate-lock-button";
      const toggleCanvasRotateLock = () => {
        uiSettings.lockCanvasRotate = ! uiSettings.lockCanvasRotate;
        updateCanvasRotateLockButton();
      }
      const updateCanvasRotateLockButton = () => {
        if( uiSettings.lockCanvasRotate === true ) {
          canvasRotateLockButton.classList.add( "on" );
          canvasRotateLockButton.style.backgroundImage = "url('icon/view-rotate-locked.png')";
        } else {
          canvasRotateLockButton.classList.remove( "on" );
          canvasRotateLockButton.style.backgroundImage = "url('icon/view-rotate-unlocked.png')";
        }
      }
      updateCanvasRotateLockButton();
      UI.registerElement(
        canvasRotateLockButton,
        {
          onclick: toggleCanvasRotateLock,
          updateContext: updateCanvasRotateLockButton
        },
        {
          tooltip: [ "Lock/Unlock View Rotate", "above", "to-right-of-center" ],
          bindings: {
            "Lock/Unlock View Rotate": toggleCanvasRotateLock
          }
        }
      );
      bottomLeftRow.appendChild( canvasRotateLockButton );
    }
    //canvas zoom lock button
    {
      const canvasZoomLockButton = document.createElement( "div" );
      canvasZoomLockButton.classList.add( "round-toggle", "animated" );
      canvasZoomLockButton.id = "canvas-zoom-lock-button";
      const toggleCanvasZoomLock = () => {
        uiSettings.lockCanvasZoom = ! uiSettings.lockCanvasZoom;
        updateCanvasZoomLockButton();
      }
      const updateCanvasZoomLockButton = () => {
        if( uiSettings.lockCanvasZoom === true ) {
          canvasZoomLockButton.classList.add( "on" );
          canvasZoomLockButton.style.backgroundImage = "url('icon/view-zoom-locked.png')";
        } else {
          canvasZoomLockButton.classList.remove( "on" );
          canvasZoomLockButton.style.backgroundImage = "url('icon/view-zoom-unlocked.png')";
        }
      }
      updateCanvasZoomLockButton();
      UI.registerElement(
        canvasZoomLockButton,
        {
          onclick: toggleCanvasZoomLock,
          updateContext: updateCanvasZoomLockButton
        },
        {
          tooltip: [ "Lock/Unlock View Zoom", "above", "to-right-of-center" ],
          bindings: {
            "Lock/Unlock View Zoom": toggleCanvasZoomLock
          }
        }
      );
      bottomLeftRow.appendChild( canvasZoomLockButton );
    }
  }

  
  const layersAboveRow = document.createElement( "div" );
  layersAboveRow.classList.add( "flex-row" );
  layersAboveRow.id = "layers-above-row";
  uiContainer.appendChild( layersAboveRow );

  //the add layers button and panel w/ sub-buttons
  {
    const addLayerButton = document.createElement( "div" );
    addLayerButton.classList.add( "round-toggle", "animated" );
    addLayerButton.id = "add-layer-button";
    let showingLayersPanel = false;
    UI.registerElement( addLayerButton, {
      onclick: () => {
        if( showingLayersPanel === true ) {
          UI.deleteContext( "add-layers-panel-visible" );
        } else {
          UI.addContext( "add-layers-panel-visible" );
        }
        addLayerButton.classList.add( "pushed" );
        setTimeout( () => addLayerButton.classList.remove( "pushed" ), UI.animationMS );
      },
      updateContext: context => {
        if( ! context.has( "layers-visible" ) ) {
          addLayerButton.classList.add( "hidden" );
          UI.deleteContext( "add-layers-panel-visible" );
          addLayerButton.uiActive = false;
        } else {
          addLayerButton.classList.remove( "hidden" );
          addLayerButton.uiActive = true;
        }

        if( context.has( "add-layers-panel-visible" ) ) {
          addLayerButton.classList.add( "on" );
        } else {
          addLayerButton.classList.remove( "on" );
        }
      },
    }, { 
      tooltip: [ "Add Layer", "below", "to-left-of-center" ],
      zIndex: 2000,
    } );

    layersAboveRow.appendChild( addLayerButton );
    
    //the add layers hovering panel
    {
      const addLayersPanel = document.createElement( "div" );
      addLayersPanel.classList.add( "animated" );
      addLayersPanel.id = "add-layers-panel";
      addLayerButton.appendChild( addLayersPanel );

      //add the stylized summon marker arrow to the top-right
      const summonMarker = document.createElement( "div" );
      summonMarker.classList.add( "summon-marker" );
      addLayersPanel.appendChild( summonMarker );

      UI.registerElement( addLayersPanel, {
        onclickout: () => {
          UI.deleteContext( "add-layers-panel-visible" );
        },
        updateContext: context => {
          if( context.has( "add-layers-panel-visible" ) ) addLayersPanel.classList.remove( "hidden" );
          else addLayersPanel.classList.add( "hidden" );
        },
      }, { zIndex: 10000 } );

      //the generative layer add button
      {
        const addGenerativeLayerButton = addLayersPanel.appendChild( document.createElement( "div" ) );
        addGenerativeLayerButton.classList.add( "rounded-line-button", "animated" );
        addGenerativeLayerButton.appendChild( new Image() ).src = "icon/magic.png";
        addGenerativeLayerButton.appendChild( document.createElement("span") ).textContent = "Add Generative Layer";
        UI.registerElement( addGenerativeLayerButton, {
          onclick: () => {
            addGenerativeLayerButton.classList.add( "pushed" );
            setTimeout( () => addGenerativeLayerButton.classList.remove( "pushed" ), UI.animationMS );
            addCanvasLayer( "generative" );
            UI.deleteContext( "add-layers-panel-visible" );
          },
          updateContext: context => {
            if( context.has( "add-layers-panel-visible" ) ) addGenerativeLayerButton.uiActive = true;
            else addGenerativeLayerButton.uiActive = false;
          }
        }, { 
          tooltip: [ "Add Paint Layer", "to-left", "vertical-center" ],
          zIndex: 11000
        } );
      }

      //add a spacer
      addLayersPanel.appendChild( document.createElement( "div" ) ).className = "spacer";

      //the paint layer add button
      {
        const addPaintLayerButton = addLayersPanel.appendChild( document.createElement( "div" ) );
        addPaintLayerButton.classList.add( "rounded-line-button", "animated" );
        addPaintLayerButton.appendChild( new Image() ).src = "icon/brush.png";
        addPaintLayerButton.appendChild( document.createElement("span") ).textContent = "Add Paint Layer";
        UI.registerElement( addPaintLayerButton, {
          onclick: () => {
            addPaintLayerButton.classList.add( "pushed" );
            setTimeout( () => addPaintLayerButton.classList.remove( "pushed" ), UI.animationMS );
            addCanvasLayer( "paint" );
            UI.deleteContext( "add-layers-panel-visible" );
          },
          updateContext: context => {
            if( context.has( "add-layers-panel-visible" ) ) addPaintLayerButton.uiActive = true;
            else addPaintLayerButton.uiActive = false;
          }
        }, { 
          tooltip: [ "Add Paint Layer", "to-left", "vertical-center" ],
          zIndex: 11000
        } );
      }

      //add a spacer
      addLayersPanel.appendChild( document.createElement( "div" ) ).className = "spacer";

      //add vector layer button
      {
        const addVectorLayerButton = addLayersPanel.appendChild( document.createElement( "div" ) );
        addVectorLayerButton.classList.add( "rounded-line-button", "animated", "unimplemented" );
        addVectorLayerButton.appendChild( new Image() ).src = "icon/path.png";
        addVectorLayerButton.appendChild( document.createElement("span") ).textContent = "Add Vector Layer";
        UI.registerElement( addVectorLayerButton, {
          onclick: () => {
            addVectorLayerButton.classList.add( "pushed" );
            setTimeout( () => addVectorLayerButton.classList.remove( "pushed" ), UI.animationMS );
            //addCanvasLayer( "vector" );
            UI.deleteContext( "add-layers-panel-visible" );
            console.error( "Vector layer unimplemented." );
          },
          updateContext: context => {
            if( context.has( "add-layers-panel-visible" ) ) addVectorLayerButton.uiActive = true;
            else addVectorLayerButton.uiActive = false;
          }
        }, { 
          tooltip: [ "!Unimplemented! Add Vector Layer", "to-left", "vertical-center" ],
          zIndex: 11000,
        } );
      }

      //add a spacer
      addLayersPanel.appendChild( document.createElement( "div" ) ).className = "spacer";

      //add text layer button
      {
        const addTextLayerButton = addLayersPanel.appendChild( document.createElement( "div" ) );
        addTextLayerButton.classList.add( "rounded-line-button", "animated", "unimplemented" );
        addTextLayerButton.appendChild( new Image() ).src = "icon/text.png";
        addTextLayerButton.appendChild( document.createElement("span") ).textContent = "Add Text Layer";
        UI.registerElement( addTextLayerButton, {
          onclick: () => {
            addTextLayerButton.classList.add( "pushed" );
            setTimeout( () => addTextLayerButton.classList.remove( "pushed" ), UI.animationMS );
            //addCanvasLayer( "text" );
            UI.deleteContext( "add-layers-panel-visible" );
            console.error( "Text layer unimplemented." );
          },
          updateContext: context => {
            if( context.has( "add-layers-panel-visible" ) ) addTextLayerButton.uiActive = true;
            else addTextLayerButton.uiActive = false;
          }
        }, { 
          tooltip: [ "!Unimplemented! Add Text Layer", "to-left", "vertical-center" ],
          zIndex: 11000,
        } );
      }

      //add a spacer
      addLayersPanel.appendChild( document.createElement( "div" ) ).className = "spacer";

      //add pose layer button
      {
        const addPoseLayerButton = addLayersPanel.appendChild( document.createElement( "div" ) );
        addPoseLayerButton.classList.add( "rounded-line-button", "animated" );
        addPoseLayerButton.appendChild( new Image() ).src = "icon/rig.png";
        addPoseLayerButton.appendChild( document.createElement("span") ).textContent = "Add Pose Layer";
        UI.registerElement( addPoseLayerButton, {
          onclick: () => {
            addPoseLayerButton.classList.add( "pushed" );
            setTimeout( () => addPoseLayerButton.classList.remove( "pushed" ), UI.animationMS );
            addCanvasLayer( "pose" );
            UI.deleteContext( "add-layers-panel-visible" );
          },
          updateContext: context => {
            if( context.has( "add-layers-panel-visible" ) ) addPoseLayerButton.uiActive = true;
            else addPoseLayerButton.uiActive = false;
          }
        }, { 
          tooltip: [ "!Unimplemented! Add Text Layer", "to-left", "vertical-center" ],
          zIndex: 11000,
        } );
      }

      //add a spacer
      addLayersPanel.appendChild( document.createElement( "div" ) ).className = "spacer";

      //the import image button
      {
        const importImageButton = addLayersPanel.appendChild( document.createElement( "div" ) );
        importImageButton.classList.add( "rounded-line-button", "animated" );
        importImageButton.appendChild( new Image() ).src = "icon/picture.png";
        importImageButton.appendChild( document.createElement("span") ).textContent = "Import Image as Layer";
        UI.registerElement( importImageButton, {
          onclick: async () => {
            importImageButton.classList.add( "pushed" );
            setTimeout( () => importImageButton.classList.remove( "pushed" ), UI.animationMS );
            
            const img = await loadImage();
            if( img === null ) {
              UI.deleteContext( "add-layers-panel-visible" );
              console.error( "Image import failed. Need to add error onscreen" );
            } else {
              const imageLayer = addCanvasLayer( "paint", img.width, img.height );
              //draw image
              imageLayer.context.drawImage( img, 0, 0 );
              flagLayerTextureChanged( imageLayer );
              //coasting on addCanvasLayer's undo function
            }


            UI.deleteContext( "add-layers-panel-visible" );

          },
          updateContext: context => {
            if( context.has( "add-layers-panel-visible" ) ) importImageButton.uiActive = true;
            else importImageButton.uiActive = false;
          }
        }, { 
          tooltip: [ "Import Image as Layer", "to-left", "vertical-center" ],
          zIndex: 11000,
        } );
      }

      //add a spacer
      addLayersPanel.appendChild( document.createElement( "div" ) ).className = "spacer";

      {
        //add the layers group add button
        const addLayerGroupButton = addLayersPanel.appendChild( document.createElement( "div" ) );
        addLayerGroupButton.classList.add( "rounded-line-button", "animated" );
        addLayerGroupButton.appendChild( new Image() ).src = "icon/folder.png";
        addLayerGroupButton.appendChild( document.createElement("span") ).textContent = "Add Layer Group";
        UI.registerElement( addLayerGroupButton, {
          onclick: () => {
            addLayerGroupButton.classList.add( "pushed" );
            setTimeout( () => addLayerGroupButton.classList.remove( "pushed" ), UI.animationMS );
            addCanvasLayer( "group" );
            UI.deleteContext( "add-layers-panel-visible" );
          },
          updateContext: context => {
            if( context.has( "add-layers-panel-visible" ) ) addLayerGroupButton.uiActive = true;
            else addLayerGroupButton.uiActive = false;
          }
        }, { 
          tooltip: [ "Add Layer Group", "to-left", "vertical-center" ],
          zIndex: 11000,
        } );
      }

    }

  }

  //the show layers button
  {
    const showLayersButton = document.createElement( "div" );
    showLayersButton.classList.add( "round-toggle", "animated" );
    showLayersButton.id = "show-layers-button";
    UI.registerElement( showLayersButton, {
      onclick: () => {
        if( UI.context.has( "layers-visible" ) ) UI.deleteContext( "layers-visible" );
        else UI.addContext( "layers-visible" );
      },
      updateContext: context => {
        if( context.has( "layers-visible" ) ) showLayersButton.classList.add( "on" );
        else showLayersButton.classList.remove( "on" );
      },
    }, { 
      tooltip: [ "Show/Hide Layers", "below", "to-left-of-center" ],
      zIndex: 10000
    } );
    UI.addContext( "layers-visible" );
    layersAboveRow.appendChild( showLayersButton );
  }


  //the air input placeholder
  {
    const airInputElement = document.createElement( "div" );
    airInputElement.id = "air-input";
    const ring = document.createElement( "div" );
    ring.className = "ring";
    airInputElement.appendChild( ring );
    airInputElement.style.display = "none";
    airInput.uiElement = airInputElement;
    airInput.colorRing = ring;
    uiContainer.appendChild( airInputElement );
  }

  //the colorwheel
  {

    const updateColorWheelPreview = () => {
      const { h,s,l } = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl;
      baseColor.style.backgroundColor = `hsl( ${h}turn 100% 50% )`;
      colorPreview.style.backgroundColor = `hsl( ${h}turn ${s*100}% ${l*100}% )`;
      document.querySelector( ".paint-tools-options-color-well" ).style.backgroundColor = `hsl( ${h}turn ${s*100}% ${l*100}% )`;
  
      //Notes; Do not delete!
      //convert HSL to coordinates
          //saturation angle: (0) -2.71 -> -0.45 (1), range = 2.26
          //luminosity angle: (0) +2.71 -> +0.45 (1), range = 2.26
          //outer-ring distance: 0.308 -> 0.355, radius = .3315
          //inner-ring distance: 0.218 -> 0.273, radius = .2455
      
      const outerRingRadius = 33.15,
        innerRingRadius = 25,
        hueAngle = (h  * Math.PI*2) - Math.PI,
        saturationAngle = -2.71 + s * 2.26,
        luminosityAngle = 2.71 - l * 2.26;
  
      {
        //hue nub
        const x = 50 + Math.cos( hueAngle ) * innerRingRadius,
          y = 50 + Math.sin( hueAngle ) * innerRingRadius;
        colorNubs.h.style.left = (x-2.5) + "%";
        colorNubs.h.style.top = (y-2.5) + "%";
      }
      {
        //saturation nub
        const x = 50 + Math.cos( saturationAngle ) * outerRingRadius,
          y = 50 + Math.sin( saturationAngle ) * outerRingRadius;
        colorNubs.s.style.left = (x-2.5) + "%";
        colorNubs.s.style.top = (y-2.5) + "%";
      }
      {
        //luminosity nub
        const x = 50 + Math.cos( luminosityAngle ) * outerRingRadius,
          y = 50 + Math.sin( luminosityAngle ) * outerRingRadius;
        colorNubs.l.style.left = (x-2.5) + "%";
        colorNubs.l.style.top = (y-2.5) + "%";
      }
  
    }
  
    //color well's shared controls shouldn't need these references
    let colorWheel, baseColor, colorPreview,
      colorNubs = { h:null, s:null, l:null };

    //the colorwheel panel
    colorWheel = document.createElement( "div" );
    colorWheel.classList.add( "color-wheel", "hidden", "animated" );
    colorWheel.id = "color-wheel";
    colorWheel.toggleVisibility = () => {
      //set position
      const r = document.querySelector( ".paint-tools-options-color-well" ).getClientRects()[0];
      colorWheel.style.top = `calc( ${r.top + r.height}px + 1rem )`;
      colorWheel.style.left = `calc( ${(r.left + r.right) / 2}px - ( var(--size) / 2 ) )`;
      if( colorWheel.classList.contains( "hidden" ) ) {
        colorWheel.classList.remove( "hidden" );
        updateColorWheelPreview();
        UI.updateContext(); //rebuild "hidden" list
      } else {
        colorWheel.classList.add( "hidden" );
        UI.updateContext(); //rebuild "hidden" list
      }
    }

    baseColor = document.createElement( "div" );
    baseColor.classList.add( "base-color" );
    colorWheel.appendChild( baseColor );

    const upperSlot = new Image();
      upperSlot.src = "ColorWheel-Slots-Upper.png";
      upperSlot.className = "upper-slot";
      colorWheel.appendChild( upperSlot );

    const lowerSlot = new Image();
      lowerSlot.src = "ColorWheel-Slots-Lower.png";
      lowerSlot.className = "lower-slot";
      colorWheel.appendChild( lowerSlot );

    const base = new Image();
      base.src = "ColorWheel-Base.png";
      base.className = "base";
      colorWheel.appendChild( base );

    const nubOverlay = document.createElement( "div" );
      nubOverlay.className = "nubs-overlay";
      colorWheel.appendChild( nubOverlay );
    for( const hslChannel in colorNubs ) {
      const nub = document.createElement( "div" );
      nub.className = "color-nub";
      colorNubs[ hslChannel ] = nub;
      nubOverlay.appendChild( nub );
    }

    colorPreview = document.createElement( "div" );
    colorPreview.classList.add( "color-preview" );
    colorWheel.appendChild( colorPreview );
    
    let draggingIn = null;

    UI.registerElement(
      base, 
      {
        onclickout: () => {
          colorWheel.classList.add( "hidden" );
        },
        ondrag: ({ rect, start, current, ending, starting, element }) => {
          //let's get the distance and angle
          const dx = current.x - (rect.left+rect.width/2),
            dy = current.y - (rect.top+rect.height/2),
            len = Math.sqrt( dx*dx + dy*dy ) / rect.width,
            ang = Math.atan2( dy, dx );
          //saturation angle: (0) -2.71 -> -0.45 (1)
          //luminosity angle: (0) +2.71 -> +0.45 (1)
          //outer-ring distance: 79 -> 91 (size=256), do %: 0.308 -> 0.355
          //inner-ring distance: 56 -> 70: 0.218 -> 0.273
          if( starting ) {
            draggingIn = null;
            if( len >= 0.308 && len <= 0.355 ) {
              //in one of the outer rings maybe
              if( ang >= -2.71 && ang <= -0.45)
                draggingIn = "saturationRing";
              else if( ang >= 0.45 && ang <= 2.71 ) {
                draggingIn = "luminosityRing"
              }
              else draggingIn = null;
            }
            else if( len >= 0.218 && len <= 0.273 ) {
              //in the hue ring
              draggingIn = "hueRing";
            }
          }

          {
            //set the color
            let updated = false;

            let { h, s, l } = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl;

            if( draggingIn === "saturationRing" ) {
              const at = Math.min( 1, Math.max( 0, 1 - (( Math.abs(ang) - 0.45 ) / (2.71-0.45)) ) );
              s = at;
              updated = true;
            }
            else if( draggingIn === "luminosityRing" ) {
              const at = Math.min( 1, Math.max( 0, 1 - (( Math.abs(ang) - 0.45 ) / (2.71-0.45)) ) );
              l = at;
              updated = true;
            }
            else if( draggingIn === "hueRing" ) {
              //normalize angle
              const nang = ( ang + Math.PI ) / (Math.PI*2);
              h = nang;
              updated = true;
            }

            if( updated ) {
              uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.h = h;
              uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.s = s;
              uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.l = l;
              updateColorWheelPreview();
            }
          }
        }
      },
      {} //no tooltip
    );

    uiContainer.appendChild( colorWheel );
  }

  //set up the asset browser
  {
    const assetBrowserContainer = document.createElement( "div" );
    assetBrowserContainer.classList.add( "overlay-background", "real-input", "animated", "hidden" );
    //assetBrowserContainer.classList.add( "overlay-background", "real-input", "animated" );
    assetBrowserContainer.id = "asset-browser-container";
    overlayContainer.appendChild( assetBrowserContainer );

    //back/close button
    {
      const closeButton = document.createElement( "div" );
      closeButton.classList.add( "overlay-close-button", "overlay-element", "animated" );
      closeButton.onclick = () => {
        enableKeyTrapping();
        openAssetBrowser.disableKeyTrapping();
        assetBrowserContainer.classList.add( "hidden" );
      }
      assetBrowserContainer.appendChild( closeButton );
    }

    //search bar
    {
      const assetBrowserSearchBar = document.createElement( "div" );
      assetBrowserSearchBar.id = "asset-browser-search-bar";
      assetBrowserContainer.appendChild( assetBrowserSearchBar );
      const magnifyingGlass = new Image();
      magnifyingGlass.src = "icon/magnifying-glass.png";
      assetBrowserSearchBar.appendChild( magnifyingGlass );
      const placeholder = document.createElement( "div" );
      placeholder.classList.add( "placeholder" );
      placeholder.textContent = "Search";
      assetBrowserSearchBar.appendChild( placeholder );
    }

    //tags bar
    if( false ){
      const assetBrowserTagsBar = document.createElement( "div" );
      assetBrowserTagsBar.id = "asset-browser-tags-bar";
      assetBrowserContainer.appendChild( assetBrowserTagsBar );
      const placeholder = document.createElement( "div" );
      placeholder.classList.add( "placeholder" );
      placeholder.textContent = "[No Tags Found]";
      assetBrowserTagsBar.appendChild( placeholder );
    }
    
    //search tags bar
    if( false ){
      const assetBrowserSearchTagsBar = document.createElement( "div" );
      assetBrowserSearchTagsBar.id = "asset-browser-search-tags-bar";
      assetBrowserContainer.appendChild( assetBrowserSearchTagsBar );
      const magnifyingGlass = new Image();
      magnifyingGlass.src = "icon/magnifying-glass.png";
      assetBrowserSearchTagsBar.appendChild( magnifyingGlass );
      const placeholder = document.createElement( "div" );
      placeholder.classList.add( "placeholder" );
      placeholder.textContent = "Search Tags";
      assetBrowserSearchTagsBar.appendChild( placeholder );
    }

    //list
    {
      const assetBrowserList = document.createElement( "div" );
      assetBrowserList.id = "asset-browser-list";
      assetBrowserContainer.appendChild( assetBrowserList );
    }

    //preview
    {
      const assetBrowserPreview = document.createElement( "div" );
      assetBrowserPreview.id = "asset-browser-preview";
      assetBrowserContainer.appendChild( assetBrowserPreview );
    }

    {
      //the apply/save button
      const applyButton = document.createElement( "div" );
      applyButton.classList.add( "overlay-apply-button", "overlay-element", "animated" );
      applyButton.id = "asset-browser-apply-button";
      applyButton.onclick = () => {
        applyButton.classList.add( "pushed" );
        setTimeout( ()=>applyButton.classList.remove("pushed"), UI.animationMS );
        enableKeyTrapping();
        assetBrowserContainer.classList.add( "hidden" );
        //assetBrowserContainer.onapply( textInput.value );
      }
      assetBrowserContainer.appendChild( applyButton );
    }

  }

}

function openAssetBrowser( assets, callback, assetName=null, multiSelectBatch=null ) {

  if( ! openAssetBrowser.keyTrap ) {
    openAssetBrowser.keyTrap = e => {
      if( e.code === "Escape" ) assetBrowserContainer.querySelector( ".overlay-close-button" ).onclick();
      if( e.code === "Enter" ) assetBrowserContainer.querySelector( ".overlay-apply-button" ).onclick();
    }
    openAssetBrowser.enableKeyTrapping = () => window.addEventListener( "keydown", openAssetBrowser.keyTrap );
    openAssetBrowser.disableKeyTrapping = () => window.removeEventListener( "keydown", openAssetBrowser.keyTrap );
  }
  

  const assetBrowserContainer = document.querySelector( "#asset-browser-container" );
  //const assetBrowserPreview = document.querySelector( "#asset-browser-preview" );

  //clear the assets list
  const list = document.querySelector( "#asset-browser-list" );
  list.innerHTML = "";
  
  //get our interpreter
  let assetInterpreterName = "simple-name";
  if( assetName !== null && assetInterpreters.hasOwnProperty( assetName ) ) {
    assetInterpreterName = assetName;
  }

  const assetInterpreter = assetInterpreters[ assetInterpreterName ];

  if( assetInterpreter.defaultSort ) {
    assets.sort( assetInterpreter.defaultSort );
  }

  //add the assets
  let activeAsset = null;
  const activeAssets = new Set();
  if( multiSelectBatch )
    multiSelectBatch.forEach( a => activeAssets.add( a ) );
  for( const asset of assets ) {
    const assetElement = assetInterpreter.makeElement( asset );
    assetElement.onclick = () => {
      if( multiSelectBatch === null ) {
        document.querySelectorAll( ".asset-element" ).forEach(
          e => e.classList.remove( "active" )
        );
        assetElement.classList.add( "active" );
        assetInterpreter.showPreview( asset );
        activeAsset = asset;
      }
      else if( multiSelectBatch ) {
        if( activeAssets.has( asset ) ) {
          activeAssets.delete( asset );
          assetElement.classList.remove( "active" );
          assetInterpreters.clearPreview();
        }
        else {
          activeAssets.add( asset );
          assetElement.classList.add( "active" );
          assetInterpreter.showPreview( asset );
        }
      }
    }
    if( multiSelectBatch?.includes?.( asset ) )
      assetElement.classList.add( "active" );
    list.appendChild( assetElement );
  }

  assetInterpreters.clearPreview();

  //activate the apply button
  const applyButton = document.querySelector( "#asset-browser-apply-button" );
  applyButton.onclick = () => {

    //just close if no clicks happened
    if( activeAsset === null && multiSelectBatch === null ) {
      enableKeyTrapping();
      assetBrowserContainer.classList.add( "hidden" );
      return;
    }

    applyButton.classList.add( "pushed" );
    setTimeout( ()=>applyButton.classList.remove("pushed"), UI.animationMS );
    enableKeyTrapping();
    assetBrowserContainer.classList.add( "hidden" );

    if( multiSelectBatch ) callback( [ ...activeAssets ] );
    else {
      uiSettings.lastUsedAssets[ assetName ] = activeAsset.uniqueId;
      callback( activeAsset );
    }

  }

  assetBrowserContainer.classList.remove( "hidden" );
  disableKeyTrapping();
  openAssetBrowser.enableKeyTrapping();

}

function setupUIFiltersControls( filterName ) {

}

function findAndPropagateControlValue( apiFlowName, controlName ) {

  if( ! selectedLayer.generativeControls.hasOwnProperty( apiFlowName ) )
    selectedLayer.generativeControls[ apiFlowName ] = {};

  if( ! uiSettings.generativeControls.hasOwnProperty( apiFlowName ) )
    uiSettings.generativeControls[ apiFlowName ] = {};

  if( uiSettings.apiFlowNamesUsed[ 0 ] !== apiFlowName ) {
    const usedIndex = uiSettings.apiFlowNamesUsed.indexOf( apiFlowName );
    if( usedIndex > -1 ) uiSettings.apiFlowNamesUsed.splice( usedIndex, 1 );
    uiSettings.apiFlowNamesUsed.unshift( apiFlowName );
  }

  let controlValue = undefined;
  if( selectedLayer.generativeControls[ apiFlowName ].hasOwnProperty( controlName ) )
    controlValue = selectedLayer.generativeControls[ apiFlowName ][ controlName ];
  else if( uiSettings.generativeControls[ apiFlowName ].hasOwnProperty( controlName ) )
    controlValue = uiSettings.generativeControls[ apiFlowName ][ controlName ];
  else {
    //go hunting for controlname
    for( const usedAPIFlowName of uiSettings.apiFlowNamesUsed ) {
      const controls = uiSettings.generativeControls[ usedAPIFlowName ] || {};
      if( controls.hasOwnProperty( controlName ) ) {
        controlValue = controls[ controlName ];
        break;
      }
    }
  }
  
  const apiFlow = apiFlows.find( flow => flow.apiFlowName === apiFlowName );
  const apiFlowControl = apiFlow?.controls?.find?.( c => c.controlName === controlName );
  
  //did we find it?
  if( controlValue === undefined ) {
    //nope. :-(
    if( ! apiFlow ) return undefined; //Just bad luck all around. How did we even get here?
    if( apiFlowControl?.hasOwnProperty?.( "controlValue" ) )
      controlValue = apiFlowControl.controlValue; //shouldn't be undefined, as that's not valid JSON!
  }

  //okay, we did the best we could. Let's go ahead and propagate it.
  selectedLayer.generativeControls[ apiFlowName ][ controlName ] = controlValue;
  uiSettings.generativeControls[ apiFlowName ][ controlName ] = controlValue;
  if( apiFlowControl ) apiFlowControl.controlValue = controlValue;

  return controlValue;

}
function updateControlValue( apiFlowName, controlName, controlValue ) {

  if( ! selectedLayer.generativeControls.hasOwnProperty( apiFlowName ) )
    selectedLayer.generativeControls[ apiFlowName ] = {};

  if( ! uiSettings.generativeControls.hasOwnProperty( apiFlowName ) )
    uiSettings.generativeControls[ apiFlowName ] = {};

  if( uiSettings.apiFlowNamesUsed[ 0 ] !== apiFlowName ) {
    const usedIndex = uiSettings.apiFlowNamesUsed.indexOf( apiFlowName );
    if( usedIndex > -1 ) uiSettings.apiFlowNamesUsed.splice( usedIndex, 1 );
    uiSettings.apiFlowNamesUsed.unshift( usedIndex );
  }

  selectedLayer.generativeControls[ apiFlowName ][ controlName ] = controlValue;
  uiSettings.generativeControls[ apiFlowName ][ controlName ] = controlValue;

  const apiFlow = apiFlows.find( flow => flow.apiFlowName === apiFlowName );
  const apiFlowControl = apiFlow?.controls?.find?.( c => c.controlName === controlName );
  if( apiFlowControl ) apiFlowControl.controlValue = controlValue;
  
}

function populateAPIFlowControls( apiFlow, selectedLayerInput = false ) {

  const controlValues = {};
  for( const control of apiFlow.controls ) {
    controlValues[ control.controlName ] = control.controlValue;
    if( control.controlType === "randomInt" ) {
      const r = Math.random();
      controlValues[ control.controlName ] = parseInt((control.min + r*(control.max-control.min))/control.step) * control.step;
    }
    if( control.controlType === "layer-input" ) {
      //The reason we don't set the .controlLayer:null on the control, is links change with selectedLayer
      let layerInput = selectedLayer; //necessarily use selected layer, otherwise we can't control the resolution
      const inputPath = [ ...control.layerPath ];
      while( inputPath.length ) {
        layerInput = layerInput[ inputPath.shift() ];
      }
      control.controlValue = layerInput;
      controlValues[ control.controlName ] = layerInput;
    }
    if( control.controlType === "duplicate" ) {
      const controlSource = apiFlow.controls.find( c => c.controlName === control.controlSourceName );
      if( ! controlSource ) console.error( "Duplicate control referenced non-existent source control name: ", control );
      else control.controlValue = controlSource.controlValue;
    }
    if( control.controlType === "image" ) {
      let sourceLayer;
      if( selectedLayerInput === false ) {
        const imageInputs = document.querySelectorAll( ".image-input-control" );
        for( const imageInput of imageInputs ) {
          if( imageInput.controlName === control.controlName && imageInput.uplinkLayer ) {
            sourceLayer = imageInput.uplinkLayer;
          }
        }
        if( ! sourceLayer ) {
          console.error( "Generate is pulling a random layer for img2img if there's nothing linked up. Need to show error code." );
          sourceLayer = layersStack.layers.find( l => l.layerType === "paint" );
        }
        if( sourceLayer.layerType === "group" && ! sourceLayer.groupCompositeUpToDate ) {
          //replace source layer with composite
          updateLayerGroupComposite( sourceLayer );
        }
      }
      if( selectedLayerInput === true ) {
        sourceLayer = selectedLayer || batchedLayers[ 0 ];
        if( ! sourceLayer || sourceLayer.layerType !== "paint" ) {
          console.error( "Generative input control no source layer selected." );
          return false;
        }
      }
      //cast source layer to generative layer's space
      if( ! populateAPIFlowControls.previewLayer ) {
        populateAPIFlowControls.previewLayer = addCanvasLayer( "_temp" );
      }
      const previewLayer = populateAPIFlowControls.previewLayer;
      sampleLayerInLayer( sourceLayer, selectedLayer, previewLayer, "rgb(0,0,0)" );
      const dataURL = previewLayer.canvas.toDataURL();
      controlValues[ control.controlName ] = dataURL;
    }
  }

  return controlValues;
}

function setupUIGenerativeToolsPanel() {

  const panel = document.querySelector( "#ai-tools-panel" );

  const toolsList = apiFlows.filter( f => f.apiFlowType === "generative-tool" );

  const panelHeight = toolsList.length * 2.5 + 1;
  panel.style.height = panelHeight + "rem";
  panel.style.top = `calc( 50% - ${panelHeight/2}rem )`;

  for( const apiFlow of toolsList) {
    const iconURL = apiFlow.icon;
    const toolName = apiFlow.apiFlowName;

    //the ai tool button
    const toolButton = panel.appendChild( document.createElement( "div" ) );
    toolButton.classList.add( "rounded-line-button", "animated" );
    toolButton.appendChild( new Image() ).src = iconURL;
    toolButton.appendChild( document.createElement("span") ).textContent = `${toolName}`;
    UI.registerElement( toolButton, {
      onclick: async () => {
        toolButton.classList.add( "pushed" );
        setTimeout( () => toolButton.classList.remove( "pushed" ), UI.animationMS );
        UI.deleteContext( "add-ai-tools-panel-visible" );

        const controlValues = populateAPIFlowControls( apiFlow, true );
        if( controlValues === false ) {
          UI.showOverlay.error( "Error: No paint layer selected." );
          return;
        }
        UI.showOverlay.generating();
        const result = await executeAPICall( toolName, controlValues );
        UI.hideOverlay.generating();
        if( result === false ) {
          UI.showOverlay.error( 'Generation failed. Stuff to check:<ul style="font-size:0.825rem; text-align:left; margin:0; padding:1rem; padding-right:0;"><li>Are the generative controls right?</li><li>Are the image inputs connected?</li><li>Is Comfy/A1111 running?</li><li>Do you have all this API\'s nodes/extensions?</li><li>Do you have all your APIKeys configured right in settings?</li><li>If this is your custom APIFlow, check the dev tools for more info.</li></ul>' );
        }
        else if( result[ "generated-image" ] ) {
          const image = result[ "generated-image" ];
          const destLayer = selectedLayer || batchedLayers[ 0 ];
          //I wonder if I need to worry about the coordinates here too though... Hmm.
          const oldData = {
            w:destLayer.w, h: destLayer.h,
            topLeft: [...destLayer.topLeft],
            bottomLeft: [...destLayer.bottomLeft],
            topRight: [...destLayer.topRight],
            bottomRight: [...destLayer.bottomRight],
            data: destLayer.context.getImageData( 0, 0, destLayer.w, destLayer.h ), 
          }

          if( image.width !== destLayer.w || image.height !== destLayer.h )
            cropLayerSizeAndRecordUndo( destLayer, image.width, image.height );
          history.pop();
          //const lassoArea = getLassoLayerForLayer( destLayer );
          //will ignore lasso? Doesn't make a ton of sense to modify only lassoed area IMO, especially since image size can change
          destLayer.context.drawImage( result[ "generated-image" ], 0, 0 );

          const newData = {
            w:destLayer.w, h: destLayer.h,
            topLeft: [...destLayer.topLeft],
            bottomLeft: [...destLayer.bottomLeft],
            topRight: [...destLayer.topRight],
            bottomRight: [...destLayer.bottomRight],
            data: destLayer.context.getImageData( 0, 0, destLayer.w, destLayer.h ), 
          }

          const historyEntry = {
            targetLayer: destLayer,
            oldData,
            newData,
            setLayerData: data => {
              historyEntry.targetLayer.w = data.w;
              historyEntry.targetLayer.h = data.h;
              historyEntry.targetLayer.topLeft = [...data.topLeft];
              historyEntry.targetLayer.topRight = [...data.topRight];
              historyEntry.targetLayer.bottomLeft = [...data.bottomLeft];
              historyEntry.targetLayer.bottomRight = [...data.bottomRight];
              historyEntry.targetLayer.context.putImageData( data.data, 0, 0 );
              flagLayerTextureChanged( destLayer, null, true );
            },
            undo: () => {
              historyEntry.setLayerData( historyEntry.oldData );
            },
            redo: () => {
              historyEntry.setLayerData( historyEntry.newData );
            }
          }

          recordHistoryEntry( historyEntry );

          if( false ) {
            const frame = makeLayerFrame( destLayer );
            destLayer.currentFrameIndex = destLayer.frames.push( frame ) - 1;
            frame.timeIndex = destLayer.currentFrameIndex;
            updateLayerFrame( destLayer, frame, true );
          }
          //flagLayerTextureChanged( destLayer, null, false );
          flagLayerTextureChanged( destLayer, null, true );
        }

      },
      updateContext: context => {
        if( context.has( "add-ai-tools-panel-visible" ) ) toolButton.uiActive = true;
        else toolButton.uiActive = false;
      }
    }, { 
      tooltip: [ `${toolName}`, "to-right", "vertical-center" ],
      zIndex: 11000
    } );

    panel.appendChild( toolButton );

  }
}

function setupUIGenerativeControls( apiFlowName ) {

  if( ! setupUIGenerativeControls.init ) {
    setupUIGenerativeControls.registeredControls = [];
    setupUIGenerativeControls.currentApiFlowName = null;
    setupUIGenerativeControls.currentSelectedLayer = null;
    setupUIGenerativeControls.init = true;
  }

  //cleanup
  for( const oldControl of setupUIGenerativeControls.registeredControls ) {
    UI.unregisterElement( oldControl );
  }
  setupUIGenerativeControls.registeredControls.length = 0;
  const controlsPanel = document.querySelector( "#generative-controls-panel" );
  controlsPanel.innerHTML = "";
  const imageInputsPanel = document.querySelector( "#generative-controls-images-inputs-panel");
  imageInputsPanel.innerHTML = "";

  if( ! apiFlowName ) {
    setupUIGenerativeControls.currentApiFlowName = null;
    setupUIGenerativeControls.currentSelectedLayer = null;
    controlsPanel.apiFlowName = null;
    selectedLayer.generativeSettings.apiFlowName = null;
    return; //nothing to do here
  }

  //assign name everywhere
  selectedLayer.generativeSettings.apiFlowName = apiFlowName;
  setupUIGenerativeControls.currentApiFlowName = apiFlowName;
  controlsPanel.apiFlowName = apiFlowName;
  
  //track layer for switch
  setupUIGenerativeControls.currentSelectedLayer = getSelectedOrBatchedLayers()[0];

  let numberOfImageInputs = 0;

  const apiFlow = apiFlows.find( flow => flow.apiFlowName === apiFlowName );
  for( const controlScheme of apiFlow.controls ) {

    //load prioritized control value if we can find one
    if( [ "asset", "text", "number" ].includes( controlScheme.controlType ) )
      findAndPropagateControlValue( apiFlowName, controlScheme.controlName );
    //controlScheme.controlValue = selectedLayer.generativeControls[ apiFlowName ]?.[ controlScheme.controlName ] || controlScheme.controlValue;
    //store control value in selected layer
    //selectedLayer.generativeControls[ apiFlowName ][ controlScheme.controlName ] = controlScheme.controlValue;

    //make the element from the type
    if( controlScheme.controlType === "asset" || controlScheme.controlType === "enum" ) {
      const assetSelectorButton = document.createElement( "div" );
      assetSelectorButton.classList.add( "asset-button-text", "round-toggle", "long", "on" );
      const controlElementLabel = document.createElement( "div" );
      controlElementLabel.classList.add( "control-element-label" );
      controlElementLabel.textContent = controlScheme.controlLabel || controlScheme.controlName;
      assetSelectorButton.appendChild( controlElementLabel );
      const buttonText = document.createElement( "div" );
      buttonText.classList.add( "button-text" );
      if( controlScheme.controlType === "enum" ) {
        const selectedOption = controlScheme.controlOptions.find( o => o.value === controlScheme.controlValue );
        buttonText.textContent = "↓ " + ( selectedOption.name || controlScheme.controlValue );
      }
      if( controlScheme.controlType === "asset" ) {
        buttonText.textContent = "↓ " + controlScheme.controlValue;
      }
      assetSelectorButton.appendChild( buttonText );
      //check if we have this asset library
      if( controlScheme.controlType === "asset" ) {
        if( ! assetsLibrary.hasOwnProperty( controlScheme.assetName ) ) {
          //download the asset if we can
          const assetAPI = apiFlows.find( a => ( (!a.isDemo) && a.apiFlowType === "asset" && a.assetLibraries.includes( controlScheme.assetName )) );
          if( assetAPI ) {
            if( apiExecutionQueue.find( q => q[ 0 ] === assetAPI.apiFlowName ) ) {
              //already scheduled, hopefully will resolve before this button is clicked
            } else {
              executeAPICall( assetAPI.apiFlowName, {} );
            }
          }
        }
      }
      UI.registerElement(
        assetSelectorButton,
        {
          onclick: () => {
            const callback = asset => {
              buttonText.textContent = "↓ " + asset.name;
              let selectedValue;
              if( controlScheme.controlType === "asset" ) selectedValue = asset.name;
              if( controlScheme.controlType === "enum" ) selectedValue = asset.value;
              controlScheme.controlValue = selectedValue;
              updateControlValue( apiFlowName, controlScheme.controlName, selectedValue );
              
              //update any of our down-stream controls that base their behavior on this asset
              const assetBasisControls = apiFlow.controls.filter( c => !!c.assetBasis );
              for( const basedControl of assetBasisControls ) {
                for( const basis of basedControl.assetBasis ) {
                  if( basis.controlName === controlScheme.controlName ) {
                    let property = asset;
                    for( let i=0; i<basis.propertyPath.length; i++ )
                      property = property?.[ basis.propertyPath[ i  ] ];

                    if( basis[ "exists" ] === "visible" ) {
                      const controlElements = [ ...document.querySelectorAll( ".control-element" ) ];
                      const controlElement = controlElements.find( ce => ce.controlName === basedControl.controlName );
                      if( controlElement ) {
                        if( property === undefined ) {
                          controlElement.classList.add( "hidden" );
                          basedControl.visible = false;
                        }
                        else {
                          controlElement.classList.remove( "hidden" );
                          basedControl.visible = true;
                        }
                      }
                    }

                    if( property === undefined && basis.hasOwnProperty( "default" ) )
                      property = basis.default;

                    if( basis.hasOwnProperty( "controlPath" ) && property !== undefined ) {
                      let target = basedControl;
                      for( let i=0; i<basis.controlPath.length-1; i++ )
                        target = target[ basis.controlPath[ i ] ];
                      if( basis.controlPath.at(-1) === "controlLabel" ) {
                        const labels = [ ...document.querySelectorAll( ".control-element-label, .image-control-element-label" ) ];
                        const label = labels.find( l => l.parentElement.controlName === basedControl.controlName );
                        if( label?.classList.contains( "control-element-label" ) )
                          label.textContent = property;
                        if( label?.classList.contains( "image-control-element-label" ) )
                          label.textContent = property.substring( 0, 5 );
                        if( label?.classList.contains( "number-slider-label" ) )
                          label.parentElement.setLabel( property );
                      }
                      if( basis.controlPath.at(-1) === "controlValue" ) {
                        const valueElements = [ ...document.querySelectorAll( ".control-element-value" ) ];
                        const valueElement = valueElements.find( l => l.parentElement.controlName === basedControl.controlName );
                        if( valueElement?.classList.contains( "number-slider-number-preview" ) )
                          valueElement.parentElement.setValue( property );
                        else valueElement.textContent = property;
                      }
                      target[ basis.controlPath.at(-1) ] = property;
                    }
                  }
                }
              }
            }
            let assetsList = [], assetName;
            if( controlScheme.controlType === "asset" ) {
              assetsList = assetsLibrary[ controlScheme.assetName ] || [];
              assetName = controlScheme.assetName;
            }
            if( controlScheme.controlType === "enum" ) {
              assetsList = controlScheme.controlOptions;
              assetName = controlScheme.controlName;
            }
            openAssetBrowser(  assetsList, callback, controlScheme.assetName );
          }
        },
        { tooltip: [ "Select " + ( controlScheme.assetName || controlScheme.controlName ), "below", "to-right-of-center" ], zIndex:10000, },
      );
      setupUIGenerativeControls.registeredControls.push( assetSelectorButton );
      controlsPanel.appendChild( assetSelectorButton );
    }
    if( controlScheme.controlType === "text" ) {
      const controlElement = document.createElement( "div" );
      controlElement.classList.add( "text-input-control", "animated", "control-element" );
      if( controlScheme.visible === false ) controlElement.classList.add( "hidden" );
      controlElement.controlName = controlScheme.controlName;
      const controlElementText = document.createElement( "div" );
      controlElementText.classList.add( "text-input-control-text", "control-element-value" );
      controlElementText.textContent = controlScheme.controlValue;
      controlElement.appendChild( controlElementText );
      const controlElementLabel = document.createElement( "div" );
      controlElementLabel.classList.add( "control-element-label" );
      controlElementLabel.textContent = controlScheme.controlLabel || controlScheme.controlName;
      controlElement.appendChild( controlElementLabel );
      setupUIGenerativeControls.registeredControls.push( controlElement );
      UI.registerElement(
        controlElement,
        {
          onclick: () => {
            const textInput = document.querySelector( "#multiline-text-input-overlay" );
            textInput.setText( controlScheme.controlValue );
            textInput.onapply = text => {
              controlElementText.textContent = text;
              controlScheme.controlValue = text;
              updateControlValue( apiFlowName, controlScheme.controlName, text );
              //store updated value in selected layer
              //selectedLayer.generativeControls[ apiFlowName ][ controlScheme.controlName ] = controlScheme.controlValue;
              //uiSettings.generativeControls[ apiFlowName ][ controlScheme.controlName ] = controlScheme.controlValue;
            }
            textInput.show();
          } 
        },
        { tooltip: [ controlScheme.controlLabel || controlScheme.controlName, "below", "to-right-of-center" ], zIndex:10000, }
      );
      controlsPanel.appendChild( controlElement );
    }
    if( controlScheme.controlType === "number" ) {
      const controlElement = UI.make.numberSlider({
        label: controlScheme.controlLabel || controlScheme.controlName,
        value: controlScheme.controlValue,
        max: controlScheme.max,
        min: controlScheme.min,
        step: controlScheme.step,
        slideMode: "contain-step",
        onstart: () => {},
        onupdate: () => {},
        onend: value => {
          controlScheme.controlValue = value;
          updateControlValue( apiFlowName, controlScheme.controlName, value );
          //selectedLayer.generativeControls[ apiFlowName ][ controlScheme.controlName ] = controlScheme.controlValue;
          //uiSettings.generativeControls[ apiFlowName ][ controlScheme.controlName ] = controlScheme.controlValue;
        },
      });
      controlElement.controlName = controlScheme.controlName;
      controlElement.classList.add( "control-element" );
      if( controlScheme.visible === false ) controlElement.classList.add( "hidden" );
      controlsPanel.appendChild( controlElement );
      controlElement.querySelector( ".number-slider-number-preview" ).classList.add( "control-element-value" );
      controlElement.querySelector( ".number-slider-label" ).classList.add( "control-element-label" );
      setupUIGenerativeControls.registeredControls.push( controlElement );
    }
    if( controlScheme.controlType === "asset" ) {}
    if( controlScheme.controlType === "layer-input" ) {}
    if( controlScheme.controlType === "image" ) {
      const controlElement = document.createElement( "div" );
      controlElement.classList.add( "image-input-control", "animated", "control-element" );
      if( controlScheme.visible === false ) controlElement.classList.add( "hidden" );

      const controlElementLabel = document.createElement( "div" );
      controlElementLabel.classList.add( "image-control-element-label" );
      controlElementLabel.textContent = controlScheme.controlHint.substring( 0, 5 ); //max 5 hint characters
      controlElement.appendChild( controlElementLabel );

      controlElement.controlName = controlScheme.controlName;
      controlElement.uplinkLayer = null;

      //look for a linked input (the link HTML element is created on UI update context)
      searchForLinkLayer:
      for( const uplinkLayer of layersStack.layers ) {
        for( const uplink of uplinkLayer.nodeUplinks ) {
          if( uplink.layerId === selectedLayer.layerId && uplink.apiFlowName === apiFlowName && uplink.controlName === controlScheme.controlName ) {
            controlElement.uplinkLayer = uplinkLayer;
            break searchForLinkLayer;
          }
        }
      }

      /* const controlElementText = document.createElement( "div" );
      controlElementText.classList.add( "text-input-control-text" );
      controlElementText.textContent = control.controlValue;
      controlElement.appendChild( controlElementText ); */
      setupUIGenerativeControls.registeredControls.push( controlElement );
      UI.registerElement(
        controlElement,
        { onclick: () => {
          console.log( "Clicked image input control" );
          //erase the control uplink layer (if any)
          if( controlElement.uplinkLayer ) {
            for( const uplink of controlElement.uplinkLayer.nodeUplinks ) {
              if( uplink.layerId === selectedLayer.layerId && uplink.apiFlowName === apiFlowName && uplink.controlName === controlScheme.controlName ) {
                controlElement.uplinkLayer.nodeUplinks.delete( uplink );
                break;
              }
            }
            controlElement.uplinkLayer = null;
            UI.updateContext();
          }
        } },
        { tooltip: [ controlScheme.controlLabel || controlScheme.controlName, "below", "to-left-of-center" ], zIndex:10000, }
      );
      imageInputsPanel.appendChild( controlElement );
      numberOfImageInputs += 1;
    }
  }

  const imageInputsWidth = 0 + numberOfImageInputs * 1.5;

  imageInputsPanel.style.width = imageInputsWidth + "rem";
  controlsPanel.style.width = `calc( 100% - ( ( var(--generate-button-width) + 2.5rem ) + ${imageInputsWidth}rem ) )`;

  UI.updateContext();

}

const keys = {};
const keyBindings = {
  "ctrl+z": { state: false, action: () => undo() },
  "ctrl+shift+z": { state: false, action: () => redo() },
  "ctrl+y": { state: false, action: () => redo() },
};
function enableKeyTrapping() {
  console.log( "Reactivated key trapping." );
  window.addEventListener( "keydown" , keyDownHandler );
  window.addEventListener( "keyup" , keyUpHandler );
}
function disableKeyTrapping() {
  console.log( "Disabled key trapping." );
  window.removeEventListener( "keydown" , keyDownHandler );
  window.removeEventListener( "keyup" , keyUpHandler );
}
function keyDownHandler( e ) { return keyHandler( e , true ); }
function keyUpHandler( e ) { return keyHandler( e , false ); }
function keyHandler( e , state ) {
    if( document.activeElement?.tagName === "INPUT" ) {
      return;
    }
    if( ! ["F5","F12"].includes( e.key ) )
      e.preventDefault?.();
    keys[ e.key ] = state;

    //update these key controls: arrow keys translate. 4&6 rotate fore and back. 8&2 zoom in and out

    let keyCombination = [];
    if( e.code.indexOf( "Key" ) === 0 ) {
      if( e.ctrlKey ) keyCombination.push( "ctrl" );
      if( e.shiftKey ) keyCombination.push( "shift" );
      keyCombination.push( e.key.toLowerCase() );
      
      const keyBinding = keyBindings[ keyCombination.join( "+" ) ];
      if( keyBinding && keyBinding.state !== state ) {
        keyBinding.state = state;
        if( state === false ) keyBinding.action();
      }
    }

    /* if( e.key === "ArrowRight" && selectedLayer ) {
      //let's move the layer right a bit
      for( const point of [ selectedLayer.bottomLeft, selectedLayer.bottomRight, selectedLayer.topLeft, selectedLayer.topRight ] ) {
        point[0] += 10;
      }
    }
    if( e.key === "ArrowLeft" && selectedLayer ) {
      //let's move the layer right a bit
      for( const point of [ selectedLayer.bottomLeft, selectedLayer.bottomRight, selectedLayer.topLeft, selectedLayer.topRight ] ) {
        point[0] -= 10;
      }
    }
    if( e.key === "ArrowUp" && selectedLayer ) {
      //let's move the layer right a bit
      for( const point of [ selectedLayer.bottomLeft, selectedLayer.bottomRight, selectedLayer.topLeft, selectedLayer.topRight ] ) {
        point[1] -= 10;
      }
    }
    if( e.key === "ArrowDown" && selectedLayer ) {
      //let's move the layer right a bit
      for( const point of [ selectedLayer.bottomLeft, selectedLayer.bottomRight, selectedLayer.topLeft, selectedLayer.topRight ] ) {
        point[1] += 10;
      }
    }
    if( e.key === "4" && selectedLayer ) {
      //let's rotate the layer a bit
      const origin = selectedLayer.topLeft;
      const da = 0.1;
      for( const point of [ selectedLayer.bottomLeft, selectedLayer.bottomRight, selectedLayer.topRight ] ) {
        const dx = point[0] - origin[0],
          dy = point[1] - origin[1],
          dist = Math.sqrt( dx**2 + dy**2 ),
          ang = Math.atan2( dy, dx ),
          newAng = ang + da,
          newX = origin[0] + dist * Math.cos( newAng ),
          newY = origin[1] + dist * Math.sin( newAng );
        point[0] = newX;
        point[1] = newY;
      }
    }
    if( e.key === "6" && selectedLayer ) {
      //let's counter-rotate the layer a bit
      const origin = selectedLayer.topLeft;
      const da = -0.1;
      for( const point of [ selectedLayer.bottomLeft, selectedLayer.bottomRight, selectedLayer.topRight ] ) {
        const dx = point[0] - origin[0],
          dy = point[1] - origin[1],
          dist = Math.sqrt( dx**2 + dy**2 ),
          ang = Math.atan2( dy, dx ),
          newAng = ang + da,
          newX = origin[0] + dist * Math.cos( newAng ),
          newY = origin[1] + dist * Math.sin( newAng );
        point[0] = newX;
        point[1] = newY;
      }
    }
    if( (e.key === "2" || e.key === "8") && selectedLayer ) {
      //let's upscale the layer a bit
      const origin = [0,0];
      //should actually recompute these using lw and lh, not my calculated distance or something
      const points = [ selectedLayer.topLeft, selectedLayer.bottomLeft, selectedLayer.bottomRight, selectedLayer.topRight ];
      for( const point of points ) {
        origin[0] += point[0];
        origin[1] += point[1];
      }
      origin[0] /= 4;
      origin[1] /= 4;
      const scale = (e.key === "8") ? 1.05 : 0.95;
      for( const point of points ) {
        const dx = point[0] - origin[0],
          dy = point[1] - origin[1],
          newX = dx * scale,
          newY = dy * scale;
        point[0] = origin[0] + newX;
        point[1] = origin[1] + newY;
      }
    } */

    //console.log( ":" + e.key + ":" );
    //console.log( `Set ${e.code} to ${state}` );
}

function resizeCanvases() {
  const r = main.getClientRects()[ 0 ];
  const w = r.width * window.devicePixelRatio;
  const h = r.height * window.devicePixelRatio;
  if( w !== W || h !== H ) {
    /* {
      cnv.width = W = w;
      cnv.height = H = h;
      //reset transform
      id3x3( viewMatrices.current );
      id3x3( viewMatrices.moving );
    } */
    {
      gnv.width = W = w;
      gnv.height = H = h;
      id3x3( viewMatrices.current );
      id3x3( viewMatrices.moving );
      gl.viewport(0,0,W,H);
    }
    UI.updateContext();
  }
}

function exportPNG() {
  //TODO: calculate the bounding box of all layers and resize the export canvas
  if( ! exportPNG.previewLayer ) {
    exportPNG.previewLayer = addCanvasLayer( "_temp" );
  }
  const previewLayer = exportPNG.previewLayer;

  const ctx = previewLayer.context;
  const {w,h} = previewLayer;
  ctx.clearRect( 0, 0, w, h );

  const layersToDraw = [];
  for( const layer of layersStack.layers ) {
    if( layer.layerType === "_temp" ) continue;
    if( layer.visibility === false ) continue;
    if( layer.layerGroupId !== null ) continue;
    layersToDraw.push( layer );
  }

  //update all the layergroups
  for( const layer of layersStack.layers )
    if( layer.layerType === "group" && ! layer.groupCompositeUpToDate )
      updateLayerGroupComposite( layer );

  console.error( "Export needs dialogue for resolution, and to export 1 layer/group. Currently exporting all layers at global resolution." );
  const pixelScale = 1;

  composeLayersGPU( previewLayer, layersToDraw, pixelScale );
  //composeLayers( previewLayer, layersToDraw, pixelScale );

  const imgURL = layersStack.layers[0].canvas.toDataURL();
  
  const a = document.createElement( "a" );
  if( uiSettings.filename === "[automatic]" )
    a.download = "ParrotLUX - export - " + Date.now() + ".png";
  else {
    if( uiSettings.addTimeStampToFilename === true ) {
      a.download = uiSettings.filename + " - " + Date.now() + ".png";
    } else {
      a.download = uiSettings.filename + ".png";
    }
  }
  a.href = imgURL;
  document.body.appendChild( a );
  a.click();
  document.body.removeChild( a );

}


function cloneObjectForJSON( sourceObject, cloneTarget, ignorePath, path=[] ) {
  if( ignorePath.includes( path.join(".") ) ) return;
  for( const key in sourceObject ) {
    const valueType = typeof sourceObject[ key ];
    if( [ "string", "number", "boolean" ].includes( valueType ) )
      cloneTarget[ key ] = sourceObject[ key ];
    else if( sourceObject[ key ] === null )
      cloneTarget[ key ] = null;
    else if( Array.isArray( sourceObject[ key ] ) ) {
      cloneTarget[ key ] ||= new Array( sourceObject[ key ].length );
      cloneObjectForJSON( sourceObject[ key ], cloneTarget[ key ], ignorePath, path.concat( key ) );
    }
    else if( valueType === "object" ) {
      cloneTarget[ key ] ||= {};
      cloneObjectForJSON( sourceObject[ key ], cloneTarget[ key ], ignorePath, path.concat( key ) );
    }
    //ignore functions
  }
}

function saveJSON() {
  let settingsClone = {};
  //const brushTipImages = uiSettings.toolsSettings.paint.modeSettings.all.brushTipsImages;
  //delete uiSettings.toolsSettings.paint.modeSettings.all.brushTipsImages;
  cloneObjectForJSON( uiSettings, settingsClone, nonSavedSettingsPaths );
  //uiSettings.toolsSettings.paint.modeSettings.all.brushTipsImages = brushTipImages;
  console.log( settingsClone );
  const uiSettingsSave = JSON.parse( JSON.stringify( settingsClone ) );
  const layersSave = [];
  for( const layer of layersStack.layers ) {
    if( layer.layerType === "_temp" ) continue;
    //drop the canvas, context, glTexture... linkNodes??? ...Yeah. Those don't save right now.
    const {
      layerType,
      layerName,
      layerId,
      layerGroupId,
      groupClosed,

      visible,
      opacity,
      alphaLocked,
      blendMode,

      generativeSettings,
      generativeControls,

      //filtersSettings,
      //filterControls,

      //currentFrameIndex,
      frames,

      nodeUplinks,

      rig,
      textInfo,
      vectors,

      w, h,
      topLeft, topRight, bottomLeft, bottomRight,
      /* textureChanged, textureChangedRect,
      maskChanged, maskChangedRect, maskInitialized, */
    } = layer;
    const saveImageDataURL = layer.canvas.toDataURL();
    let saveMaskDataURL = null;
    if( layer.maskInitialized ) saveMaskDataURL = layer.maskCanvas.toDataURL();
    layersSave.push( {
      layerType,
      layerName,
      layerId,
      layerGroupId,
      groupClosed,

      visible,
      opacity,
      alphaLocked,
      blendMode,

      rig,
      textInfo,
      vectors,

      generativeSettings,
      generativeControls,

      //filtersSettings,
      //filterControls,

      //currentFrameIndex,
      frames: [ ...frames ],

      nodeUplinks: [ ...nodeUplinks ],

      w, h,
      topLeft, topRight, bottomLeft, bottomRight,

      //compat feature, will replace with frame load on load, add compat convert
      saveImageDataURL,
      saveMaskDataURL
    } );

  }

  const saveFile = {
    uiSettingsSave,
    layersSave
  }

  const saveFileString = JSON.stringify( saveFile );

  const a = document.createElement( "a" );
  if( uiSettings.filename === "[automatic]" )
    a.download = "ParrotLUX - save - " + Date.now() + ".json";
  else {
    if( uiSettings.addTimeStampToFilename === true ) {
      a.download = uiSettings.filename + " - " + Date.now() + ".json";
    } else {
      a.download = uiSettings.filename + ".json";
    }
  }
  const b = new Blob( [saveFileString], { type: "application/json" } );
  a.href = URL.createObjectURL( b );
  document.body.appendChild( a );
  a.click();
  document.body.removeChild( a );
  URL.revokeObjectURL( b );

  uiSettings.unsavedChanges = false;

}

function loadImage() {
  console.error( "Need to lock UI for async file load." );

  return new Promise( returnImage => {
    const fileInput = document.createElement( "input" );
    fileInput.type = "file";
    fileInput.style = "position:absolute; left:0; top:0; opacity:0;";
    document.body.appendChild( fileInput );
    fileInput.addEventListener( "change", e => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => returnImage( img );
        img.onerror = () => returnImage( null );
        img.src = reader.result;
        
        document.body.removeChild( fileInput );
      }
      reader.readAsDataURL( e.target.files[0] );
    } );
    fileInput.click();
  } )
}

function loadJSON() {

  if( uiSettings.unsavedChanges === true && confirm( "Close current project? Unsaved data will be lost." ) === false ) {
    return false;
  }

  console.error( "Need to lock UI for async file load." );
  looping = false;

  const fileInput = document.createElement( "input" );
  fileInput.type = "file";
  fileInput.style = "position:absolute; left:0; top:0; opacity:0;";
  document.body.appendChild( fileInput );
  fileInput.addEventListener( "change", e => {
    const reader = new FileReader();
    reader.onload = async e => {
      let saveFile;
      try {
        saveFile = JSON.parse( e.target.result );
      } catch (e ) {
        console.error( "Bad JSON file loaded." );
      }

      if( saveFile ) {

        const { uiSettingsSave, layersSave } = saveFile;

        cloneObjectForJSON( uiSettingsSave, uiSettings, nonSavedSettingsPaths );
        uiSettings.nodeSnappingDistance = Math.min( innerWidth, innerHeight ) * 0.04; //~50px on a 1080p screen
        loadBrushTipsImages();
        uiSettings.setActiveTool( null );
      
        //if we opened over an existing file, we have to clear everything up
        //clear layers
        const layersToDelete = [ ...layersStack.layers ];
        for( const layer of layersToDelete ) {
          if( layer.layerType === "_temp" ) continue;
          deleteLayer( layer );
        }
        //clear undo and redo
        clearUndoHistory();
        //clear lasso
        clearLassoStack();
        //I think that's everything? :-O
        
        let lastLayer;
        for( const layer of layersSave ) {
          let doNotUpdate = true;
          let newLayer = addCanvasLayer( layer.layerType, layer.w, layer.h, lastLayer, doNotUpdate );
          lastLayer = newLayer;
          const img = new Image();
          img.onload = () => {
            newLayer.context.drawImage( img, 0, 0 );
            newLayer.textureChanged = true;
          }
          img.src = layer.saveImageDataURL;

          if( layer.saveMaskDataURL !== null ) {
            const mask = new Image();
            mask.onload = () => {
              initializeLayerMask( newLayer, "transparent" );
              newLayer.maskContext.drawImage( mask, 0, 0 );
              newLayer.maskChanged = true;
              //technically not necessary, set in initializeLayerMask:
              newLayer.maskInitialized = true;
              //necessary override unpainted on normal init:
              newLayer.maskUnpainted = false;
            }
            mask.src = layer.saveMaskDataURL;
          }

          const {
            layerType,
            layerName,
            layerId,
            layerGroupId,
            groupClosed,
      
            visible,
            opacity,
            alphaLocked,
            blendMode,
      
            generativeSettings,
            generativeControls,
            
            //filtersSettings,
            //filterControls,

            //currentFrameIndex,
            frames,

            nodeUplinks,

            rig,
            textInfo,
            vectors,
            
            w, h,
            topLeft, topRight, bottomLeft, bottomRight,
          } = layer;

          newLayer.layerType = layerType || "paint";
          newLayer.layerName = layerName || "Unnamed Layer"; //update context will update this into label
          newLayer.layerId = layerId; //no pre-id versioning available
          layersAddedCount = Math.max( layersAddedCount, layerId )
          newLayer.layerGroupId = layerGroupId || null;
          newLayer.groupCompositeUpToDate = false;
          newLayer.groupClosed = groupClosed || false;

          //newLayer.visible = visible;
          newLayer.setVisibility( visible || true ); //update icon
          //newLayer.opacity = opacity;
          newLayer.setOpacity( isNaN( opacity ) ? 1.0 : opacity ); //update slider position
          //newLayer.alphaLocked = alphaLocked;
          newLayer.setAlphaLocked( alphaLocked || false ); //update lock icon
          newLayer.blendMode = blendMode || "normal"; //update context will update this to label

          newLayer.generativeSettings = generativeSettings;
          newLayer.generativeControls = generativeControls;

          newLayer.currentFrameIndex = uiSettings.currentTimeSeekIndex;
          newLayer.frames = frames || [];
          
          newLayer.nodeUplinks = new Set( nodeUplinks||[] );

          if( rig ) newLayer.rig = rig;
          if( textInfo ) newLayer.textInfo = textInfo;
          if( vectors ) newLayer.vectors = vectors;

          newLayer.w = w;
          newLayer.h = h;
          newLayer.topLeft = topLeft;
          newLayer.topRight = topRight;
          newLayer.bottomLeft = bottomLeft;
          newLayer.bottomRight = bottomRight;

          newLayer.textureChanged = false;
          newLayer.maskChanged = false;
          //initialized to full panel, leave
          //newLayer.textureChangedRect = textureChangedRect;
        }

        //update the brush color preview
        {
          const { h,s,l } = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl;
          document.querySelector( ".paint-tools-options-color-well" ).style.backgroundColor = `hsl( ${h}turn ${s*100}% ${l*100}% )`;
        }

        selectLayer( null );

        //clear undo again so we can't one-by-one remove our loaded layers
        clearUndoHistory();

        reorganizeLayerButtons();

        //reset the view
        viewMatrices.current[0] = 1; viewMatrices.current[1] = 0; viewMatrices.current[2] = 0;
        viewMatrices.current[3] = 0; viewMatrices.current[4] = 1; viewMatrices.current[5] = 0;
        UI.updateView();

        UI.updateContext();

        uiSettings.unsavedChanges = false;

        looping = true;

      }
      
      document.body.removeChild( fileInput );

    }
    reader.readAsText( e.target.files[0] );
  } );
  fileInput.click();

}

const painter = {
    queue: [],
    active: false
}

const cursor = {
    current: { x:0, y:0 },
    mode: "none",
    origin: { x:0, y:0 },
    zoomLength: 50
}

const pincher = {
    ongoing: false,
    origin: { 
        a: {x:0,y:0,id:null},
        b: {x:0,y:0,id:null},
        center: {x:0,y:0},
        length: 0,
        angle: 0
    },
    current: {
        a: {x:0,y:0,id:null},
        b: {x:0,y:0,id:null}
    },
}

const pointers = {
    active: {},
    count: 0
}

const uiElements = new Map();
const uiHandlers = {
  move: null,
  end: null
}

const UI = {

  elements: new Map(),
  context: new Set(),

  animationMS: 200, //also set in CSS, as .animated { --animation-speed }

  pointerHandlers: {},

  showOverlay: {
    controlPanel: () => {
      document.querySelector("#settings-controlpanel-overlay").show();
    },
    text: ( { value="", onapply=txt=>console.log(txt), label="" } ) => {
      const textInput = document.querySelector( "#multiline-text-input-overlay" );
      textInput.setText( value );
      textInput.setLabel( label );
      textInput.onapply = onapply;
      textInput.show();
    },
    number: ( { value=0, min=0, max=1, step=0.1, onapply=num=>console.log(num), label="" } ) => {
      const numberInputOverlay = document.querySelector( "#number-input-overlay" ),
        numberInput = numberInputOverlay.querySelector( "input" );
      numberInputOverlay.setLabel( label );
      numberInput.value = value;
      if( isFinite( min ) ) numberInput.min = min;
      else numberInput.removeAttribute( "min" );
      if( isFinite( max ) ) numberInput.max = max;
      else numberInput.removeAttribute( "max" )
      numberInput.step = step;
      numberInputOverlay.onapply = onapply;
      numberInputOverlay.show();
    },
    save: () => {
      const saveOverlay = document.querySelector( "#filename-input-overlay" );
      document.querySelector( ".overlay-filename-input" ).value = uiSettings.filename;
      saveOverlay.show();
    },
    error: errorHTML => {
      const errorNotificationOverlay = document.querySelector( "#error-notification-overlay" );
      errorNotificationOverlay.querySelector( ".overlay-error-notification" ).innerHTML = errorHTML;
      errorNotificationOverlay.show();
    },
    generating: () => {
      const generatingOverlay = document.querySelector( "#generating-overlay" );
      generatingOverlay.show();
    },
  },
  hideOverlay: {
    generating: () => {
      const generatingOverlay = document.querySelector( "#generating-overlay" );
      generatingOverlay.hide();
    }
  },

  make: {
    slider: ( { orientation, onchange, initialValue=1, min=0, max=1, tooltip, zIndex=0, updateContext=null } ) => {
      if( orientation === "horizontal" ) {
        const slider = document.createElement( "div" );
        slider.classList.add( "slider", "horizontal", "animated" );
        const nub = slider.appendChild( document.createElement( "div" ) );
        nub.classList.add( "nub" );
        slider.value = initialValue;
        slider.min = min;
        slider.max = max;
        const updateValue = ( {rect,current} ) => {
          let {x,y} = current;
          x -= rect.left; y -= rect.top;
          x /= rect.width; y /= rect.height;
          x = Math.max( 0, Math.min( 1, x ) );
          y = Math.max( 0, Math.min( 1, y ) );
          const p = x;
          const value = parseFloat(slider.min) + (parseFloat(slider.max) - parseFloat(slider.min))*p;
          slider.setValue( value );
          onchange( slider.value )
        };
        slider.setValue = value => {
          value = Math.max( slider.min, Math.min( slider.max, value ) );
          slider.value = value;
          const valuePosition = parseInt( 100 * ( slider.value - slider.min ) / ( slider.max - slider.min ) );
          const realPosition = Math.min( 99, Math.max( 5, valuePosition ) );
          nub.style.left = realPosition + "%";
        }
        slider.setValue( initialValue );
        const registration = { ondrag: updateValue };
        UI.registerElement( slider, registration, { tooltip, zIndex } )
        if( updateContext ) registration.updateContext = updateContext;
        return slider;
      }
    },
    numberSlider: ( {
      label="", value=0, min=0, max=1, step=0.1, slideMode="contain-range", wrap=false, unclamped = false,
      onstart=()=>{}, onupdate=()=>{}, onend=()=>{},
      bindingsName="",
    } ) => {

      const checkInfiniteBoundExists = () => Math.abs(min) === Infinity || Math.abs(max) === Infinity;

      value *= 1;
      min *= 1;
      max *= 1;
      step = Math.abs( step * 1 );
      if( isNaN( value ) ) value = 0;
      if( Math.abs( value ) === Infinity ) value = 0;
      if( isNaN( min ) ) min = 0;
      if( isNaN( max ) ) max = 1;
      if( isNaN( step ) ) step = 1;
      if( Math.abs( step ) === Infinity ) step = 1;

      if( step === 0 ) step = 1;
      if( unclamped === false && ! checkInfiniteBoundExists() ) {
        if( max <= min ) max = min + step * 2;
        while( value < min ) value += ( max - min );
        while( value > max ) value -= ( max - min );
      } else {
        //can't contain non-finite range, after all
        slideMode = "contain-step";
      }

      const sliderElement = document.createElement( "div" );

      sliderElement.classList.add( "number-slider", "animated" );
      //controlElement.controlName = control.controlName;

      const sliderLabel = document.createElement( "div" );
      sliderLabel.classList.add( "number-slider-label" );
      sliderLabel.textContent = label;
      sliderElement.appendChild( sliderLabel );

      const leftArrow = sliderElement.appendChild( document.createElement( "div" ) );
      leftArrow.classList.add( "number-slider-left-arrow" );

      const numberPreview = sliderElement.appendChild( document.createElement( "div" ) );
      numberPreview.classList.add( "number-slider-number-preview" );
      //numberPreview.textContent = value;
      numberPreview.showValue = ()=> {
        let number = value + "";
        if( number.indexOf( "." ) !== -1 )  {
          if( trimLength === 0 ) number = number.substring( 0, number.indexOf( "." ) );
          else number = number.substring( 0, number.indexOf( "." )+1 + trimLength );
        }
        numberPreview.textContent = number;
      }
      numberPreview.updateTrimLength = () => {
        trimLength = ( (''+step).indexOf( "." ) === -1 ) ? 0 : (''+step).substring( (''+step).indexOf( "." )+1 ).length;  
      }
      let trimLength;
      numberPreview.updateTrimLength();
      numberPreview.showValue();

      const rightArrow = sliderElement.appendChild( document.createElement( "div" ) );
      rightArrow.classList.add( "number-slider-right-arrow" );

      let startingNumber, adjustmentScale;

      if( bindingsName )
        console.error( "Number slider keyboard bindings unimplemented." );

      UI.registerElement(
        sliderElement,
        {
          ondrag: ({ rect, start, current, ending, starting, element }) => {

            let isClick = false;
            const clickDriftLength = 10; //move to uiSettings? I think we have similar code on scroll afterall.
            const dy = current.y - start.y,
              dx = current.x - start.x,
              d = Math.sqrt( dx**2 + dy**2 ),
              dt = current.t - start.t;
            let px;
            if( d < clickDriftLength && dt < uiSettings.clickTimeMS ) {
              const {x,y} = current,
                {top,left,bottom,right} = rect;
              if( typeof top !== "number" ) isClick = false;
              else if( x < left || x > right || y < top || y > bottom ) isClick = false;
              else {
                isClick = true;
                px = ( x - left ) / ( right - left );
              }
            }

            if( starting ) {
              sliderElement.onstart( value );
              sliderElement.querySelector( ".tooltip" ).style.opacity = 0;
              startingNumber = value;
              if( slideMode === "contain-range" && unclamped === false && ! checkInfiniteBoundExists() ) adjustmentScale = ( max - min ) / 300; //300 pixel screen-traverse
              else adjustmentScale = step / 3; //1 step per every 3 pixels
            }

            if( isClick === false ) sliderElement.onupdate( value );

            if( isClick === false ) {
              const adjustment = dx * adjustmentScale;
              let number = startingNumber + adjustment;
              if( unclamped === false ) {
                if( wrap === false ) value = Math.max( min, Math.min( max, value ) ); //fine even for infinite bounds... more or less; Infinity is not valid JSON
                if( wrap === true ) {
                  if( max === min ) value = max;
                  else {
                    while( value < min ) value += Math.abs( max - min );
                    while( value > max ) value -= Math.abs( max - min );
                  }
                }
              }
              number = parseInt( number / step ) * step;
              value = number;
              numberPreview.showValue();
            }
            
            if( ending ) {
              sliderElement.querySelector( ".tooltip" ).style = "";
              if( isClick === true ) {
                if( px < 0.25 ) {
                  //clicked left of input, decrement
                  sliderElement.setValue( value - step );
                  numberPreview.showValue();
                  sliderElement.onend( value );
                }
                else if( px > 0.75 ) {
                  //clicked right of input, increment
                  sliderElement.setValue( value + step );
                  numberPreview.showValue();
                  sliderElement.onend( value );
                }
                else {
                  //clicked center of input, open number prompt
                  UI.showOverlay.number( {
                    value,min,max,step,
                    onapply: v => {
                      sliderElement.setValue( v );
                      numberPreview.showValue();
                      sliderElement.onend( value );
                    }
                  })
                }
              } else {
                const adjustment = dx * adjustmentScale;
                let number = startingNumber + adjustment;
                sliderElement.setValue( number );
                numberPreview.showValue();
                sliderElement.onend( value );
              }
            }
          },
          //updateContext: () => {}
        },
        { tooltip: [ '<img src="icon/arrow-left.png"> Drag to Adjust ' + label + ' <img src="icon/arrow-right.png">', "below", "to-right-of-center" ], zIndex:10000, }
      );

      sliderElement.increase = () => console.error( "Slider increase unimplemented." );
      sliderElement.decrease = () => console.error( "Slider decrease unimplemented." );
      sliderElement.setLabel = label => {
        sliderElement.querySelector( ".number-slider-label" ).textContent = label;
        sliderElement.querySelector( ".tooltip" ).innerHTML = '<img src="icon/arrow-left.png"> Drag to Adjust ' + label + ' <img src="icon/arrow-right.png">';
      }
      sliderElement.setValue = v => {
        v *= 1;
        if( isNaN( v ) ) v = 0;
        if( Math.abs( v ) === Infinity ) v = 0;
        if( unclamped === false ) {
          if( wrap === false ) v = Math.max( min, Math.min( max, v ) );
          if( wrap === true ) {
            while( v < min ) v += Math.abs( max - min );
            while( v > max ) v -= Math.abs( max - min );
          }
        }
        value = parseInt( v / step ) * step;
        numberPreview.showValue();
      }
      sliderElement.setMin = newMinimum => {
        newMinimum *= 1;
        if( isNaN( newMinimum ) ) return min = max + step;
        if( newMinimum >= max ) max = newMinimum + step;
        min = newMinimum;
      }
      sliderElement.setMax = newMaximum => {
        newMaximum *= 1;
        if( isNaN( newMaximum ) ) return max = min - step;
        if( newMaximum <= min ) min = newMaximum - step;
        max = newMaximum;
      }
      sliderElement.setStep = newStep => {
        newStep *= 1;
        if( ! newStep ) newStep = 1;
        if( isNaN( newStep ) ) newStep = 1;
        if( Math.abs( newStep ) === Infinity ) newStep = 1;
        step = newStep;
        numberPreview.updateTrimLength();
      }
      sliderElement.setSlide = s => slideMode = s;
      sliderElement.onstart = onstart;
      sliderElement.onupdate = onupdate;
      sliderElement.onend = onend;

      return sliderElement;

    }
  },

  addContext: ( hint ) => {
    if( UI.context.has( hint ) ) return;
    UI.context.add( hint );
    UI.updateContext();
  },
  deleteContext: ( hint ) => {
    if( ! UI.context.has( hint ) ) return;
    UI.context.delete( hint );
    UI.updateContext();
  },
  visibleElements: [],
  updateContext: () => {
    for( const [,events] of UI.elements ) {
      events.updateContext?.( UI.context );
    }

    const { visibleElements } = UI;
    visibleElements.length = 0;
    for( const [element,events] of UI.elements ) {
      if( element.classList.contains( "hidden" ) ||
        element.parentElement?.classList.contains( "hidden" ) ||
        element.parentElement?.parentElement?.classList.contains( "hidden" ) ||
        element.parentElement?.parentElement?.parentElement?.classList.contains( "hidden" ) ) {
          element.classList.remove( "hovering" );
          continue;
        }

      visibleElements.push( [element,events] );
    }
  },

  updateView: () => {
    for( const [,events] of UI.elements ) {
      events.updateView?.();
    }
  },

  insertCount: 0,
  registerElement: ( element, events, misc = {} ) => {
    UI.elements.set( element, events );
    element.uiActive = true;
    if( misc.tooltip ) {
      element.classList.add( "tooltip-holder" );
      const tip = document.createElement( "div" );
      tip.classList.add( "tooltip", "animated" );
      tip.innerHTML = misc.tooltip[ 0 ];
      for( let i=1; i<misc.tooltip.length; i++ )
        tip.classList.add( misc.tooltip[ i ] );
      element.appendChild( tip );
    }
    if( misc.zIndex ) {
      element.zIndex = misc.zIndex;
    } else {
      element.zIndex = 0;
    }
    element.insertOrder = ++UI.insertCount;
    events.updateContext?.( UI.context );
  },
  unregisterElement: ( element ) => {
    UI.elements.delete( element );
    element.uiActive = false;
  },

  hovering: false,
  updateHover: p => {
    
    const x = p.clientX, y = p.clientY;

    let hovering = false;

    for( const [element] of UI.visibleElements ) {

      if( element.classList.contains( "no-hover" ) ) continue;

      const r = element.getClientRects()[0];
      if( ! r ) continue; //element is invisible or off-screen
      
      //allowed to hover non-active elements because tooltip may reveal activation conditions

      if( x < r.left || x > r.right || y < r.top || y > r.bottom ) {
        element.classList.remove( "hovering" );
        continue;
      }

      if( hovering && element.zIndex > hovering.zIndex ) {
        hovering.classList.remove( "hovering" );
        hovering = null;
      }

      if( ! hovering ) {
        hovering = element;
        element.classList.add( "hovering" );
      }
    }
    
    UI.hovering = !!hovering;

  },
  cancelHover: () => {
    if( UI.hovering === false ) return;
    for( const [element] of UI.visibleElements )
      element.classList.remove( "hovering" );
  },

  testElements: p => {

    const x = p.clientX, y = p.clientY;
    const reverseElements = [ ...UI.visibleElements ].reverse();
    reverseElements.sort( (a,b) => (( b[0].zIndex - a[0].zIndex ) || ( b[0].insertOrder - a[0].insertOrder )) );
    for( const [element,events] of reverseElements ) {

      if( ! element.uiActive ) continue;

      const r = element.getClientRects()[0];

      if( ! r ) continue; //element is invisible or off-screen

      if( x < r.left || x > r.right || y < r.top || y > r.bottom ) {
        events.onclickout?.();
        continue;
      }

      if( events.onclick ) {
        let inrange = true;
        UI.pointerHandlers[ p.pointerId ] = {
          move: p => {
            const x = p.clientX, y = p.clientY;
            inrange = ! ( x < r.left || x > r.right || y < r.top || y > r.bottom );
          },
          end: p => {
            if( inrange ) events.onclick();
            delete UI.pointerHandlers[ p.pointerId ];
          }
        }
      }
      if( events.ondrag ) {
        const rect = r,
          start = {x,y,t:performance.now(),dt:0},
          current = {x,y,t:performance.now(),dt:1};
        UI.pointerHandlers[ p.pointerId ] = {
          move: ( p, starting = false ) => {
            current.x = p.clientX;
            current.y = p.clientY;
            const t = performance.now();
            current.dt = t - current.t;
            current.t = t;
            events.ondrag({ rect, start, current, ending: false, starting, element });
          },
          end: p => {
            current.x = p.clientX;
            current.y = p.clientY;
            current.t = performance.now();
            events.ondrag({ rect, start, current, ending: true, starting: false, element });
            delete UI.pointerHandlers[ p.pointerId ];
          }
        }
        UI.pointerHandlers[ p.pointerId ].move( p, true );
      }

      if( ! events.onclick && ! events.ondrag ) {
        //passive element
        continue;
      }

      return true;

    }
    return false;

  },

}

function registerUIElement( element, events ) {
  uiElements.set( element, events );
  element.uiActive = true;
}
function unregisterUIElement( element ) {
  uiElements.delete( element );
  element.uiActive = false;
}


let info = "";

const contextMenuHandler = p => {
  //info += "C";
  cancelEvent( p );
}
const startHandler = p => {

    cancelEvent( p );

    //Linux pen pressure in Chromium always starts and ends at zero. :-|
    if( p.pressure > 0 || true ) {
      const caughtByUI = UI.testElements( p );
      if( caughtByUI ) return false;
    }

    document.activeElement?.blur();    

    const x = p.offsetX * window.devicePixelRatio,
        y = p.offsetY * window.devicePixelRatio;

    pointers.active[ p.pointerId ] = {
        origin: { x , y, id:p.pointerId },
        current: { x , y, id:p.pointerId },
        id:p.pointerId,
        t:p.pointerType,
        airButton: p.pressure === 0
    }

    pointers.count = Object.keys( pointers.active ).length;

    if( pointers.count === 1 ) {
        pincher.ongoing = false;

        const point = [x,y,1];
        const { selectedAndBatchedLayers, layerContainingPoint } = getSelectedOrBatchedLayerContainingPoint( point );

        if( keys[ " " ] === true ) {
            cursor.origin.x = x;
            cursor.origin.y = y;
            cursor.current.x = x;
            cursor.current.y = y;
            if( p.buttons === 1 && ( keys[ "Shift"] !== true && keys[ "Control" ] !== true ) ) {
              cursor.mode = "pan";
            }
            if( p.buttons === 2 || ( keys[ "Shift" ] === true && keys[ "Control" ] !== true ) ) {
                //get center of screen
                cursor.origin.x = gnv.width/2;
                cursor.origin.y = gnv.height/2;

                const dx = cursor.origin.x - cursor.current.x;
                const dy = cursor.origin.y - cursor.current.y;
          
                view.initialAngleOffset = -Math.atan2( dy , dx );

                cursor.mode = "rotate";
            }
            if( p.buttons === 4 || ( keys[ "Control" ] === true && keys[ "Shift" ] !== true ) ) {
                cursor.origin.x = gnv.width/2;
                cursor.origin.y = gnv.height/2;

                const dx = cursor.origin.x - cursor.current.x;
                const dy = cursor.origin.y - cursor.current.y;
          
                view.initialZoomLength = Math.sqrt( dx**2 + dy**2 );

                cursor.mode = "zoom";
            }

            //check if one of our points is inside the one of the selected layers, both for painting and transforming
            if( uiSettings.activeTool === "transform" ) {
              if( layerContainingPoint ) {
                //activate transform
                uiSettings.toolsSettings.transform.current = true;
                uiSettings.toolsSettings.transform.transformingLayers.length = 0;
                uiSettings.toolsSettings.transform.transformingLayers.push( ...selectedAndBatchedLayers );


                //get layer(s) center(s)
                if( cursor.mode === "rotate" || cursor.mode === "zoom" ) {
                  let lx=0, ly=0, i = 0;
                  for( const layer of uiSettings.toolsSettings.transform.transformingLayers ) {
                    for( const pointName of [ "topLeft", "bottomRight", "bottomLeft", "topRight" ] ) {
                      lx += layer[ pointName ][ 0 ];
                      ly += layer[ pointName ][ 1 ];
                      i++;
                    }
                  }
                  lx /= i;
                  ly /= i;
                  //transform center to screen space
                  getTransform();
                  [lx,ly] = transformPoint( [lx,ly,1] );
                  cursor.origin.x = lx;
                  cursor.origin.y = ly;

                  const dx = cursor.origin.x - cursor.current.x;
                  const dy = cursor.origin.y - cursor.current.y;
            
                  layerTransform.initialAngleOffset = -Math.atan2( dy , dx );
                  layerTransform.initialZoomLength = Math.sqrt( dx**2 + dy**2 );
                }

              }
              else {
                uiSettings.toolsSettings.transform.current = false;
                uiSettings.toolsSettings.transform.transformingLayers.length = 0;
              }
            }
        }
        else if( p.pointerType !== "touch" && layerContainingPoint &&
          ( uiSettings.isActiveTool( "paint" ) || uiSettings.isActiveTool( "mask" ) ) ) {
          beginPaintGPU2( layerContainingPoint );
          //reset and activate the painter
          painter.queue.length = 0;
          painter.active = true;
        }
        else if( p.pointerType !== "touch" && uiSettings.isActiveTool( "lasso" ) ) {
          //point need not be contained in layer, and layerContainingPoint is irrelevant
          beginLasso();
          //reset and activate the painter
          painter.queue.length = 0;
          painter.active = true;
        }
    }
    else {
        cursor.mode = "none";
        cursor.origin.x = 0;
        cursor.origin.y = 0;
        cursor.current.x = 0;
        cursor.current.y = 0;
    }
    if( pointers.count === 2 && existsVisibleLayer()  ) {


        pincher.ongoing = true;
        const [ idA , idB ] = Object.keys( pointers.active ),
            a = pointers.active[ idA ],
            b = pointers.active[ idB ];
        pincher.origin.a.x = a.origin.x;
        pincher.origin.a.y = a.origin.y;
        pincher.origin.a.id = idA;
        pincher.origin.b.x = b.origin.x;
        pincher.origin.b.y = b.origin.y;
        pincher.origin.b.id = idB;

        pincher.current.a.x = a.current.x;
        pincher.current.a.y = a.current.y;
        pincher.current.a.id = idA;
        pincher.current.b.x = b.current.x;
        pincher.current.b.y = b.current.y;
        pincher.current.b.id = idB;

        const dx = b.origin.x - a.origin.x;
        const dy = b.origin.y - a.origin.y;
        const d = Math.sqrt( dx*dx + dy*dy );
        const angle = Math.atan2( dy , dx );
        const cx = ( a.origin.x + b.origin.x ) / 2,
            cy = ( a.origin.y + b.origin.y ) / 2;
        pincher.origin.length = d;
        pincher.origin.angle = angle;
        pincher.origin.center = { x:cx , y:cy }

        //check if one of our points is inside the selected layer, and disable transform if not
        if( uiSettings.activeTool === "transform" ) {
          const points = [ [a.origin.x,a.origin.y,1], [b.origin.x,b.origin.y,1] ];
          const selectedAndBatchedLayers = getSelectedOrBatchedLayers();
          let layerContainingPoint = null;
          for( const layer of selectedAndBatchedLayers ) {
            if( testPointsInLayer( layer, points, true ) ) {
              layerContainingPoint = layer;
              break;
            }
          }

          uiSettings.toolsSettings.transform.transformingLayers.length = 0;
          if( layerContainingPoint ) {
            uiSettings.toolsSettings.transform.current = true;
            uiSettings.toolsSettings.transform.transformingLayers.push( ...selectedAndBatchedLayers );
          }
          else {
            uiSettings.toolsSettings.transform.current = false;
          }
        }
    }
    
    moveHandler( p, true );

    return false;
}
const _inverter = [
    1 , 0 , 0 ,
    0 , 1 , 0 ,
    0 , 0 , 1
];
const moveHandler = ( p, pseudo = false ) => {

    cancelEvent( p );

    //The reason we can't support Firefox pentablet on windows is it returns a new PointerID for every pen event, no matter what.
    
    if( p.pointerType !== "touch" && pseudo === false ) {
      if( airInput.active ) {
        if( p.buttons === 0 && p.pressure === 0 && !keys[ "o" ] ) {
          endAirInput( p );
        }
        else if( ( p.buttons && p.pressure === 0 ) || keys[ "o" ] ) {
          inputAirInput( p );
        }  
      }
      else if( ( p.buttons && p.pressure === 0 ) || keys[ "o" ] ) {
        beginAirInput( p );
      }
    }
    
    if( UI.pointerHandlers[ p.pointerId ] )
      return UI.pointerHandlers[ p.pointerId ].move( p );

    const x = p.offsetX * window.devicePixelRatio,
        y = p.offsetY * window.devicePixelRatio;

    if( pointers.count === 1 ) {
        if( cursor.mode !== "none" ) {
            cursor.current.x = x;
            cursor.current.y = y;
        }
        if( uiSettings.activeTool === "flood-fill" ) {
          cursor.current.x = x;
          cursor.current.y = y;
        }
        if( painter.active === true ) {
          const point = [ x , y , 1, p.pressure, p.altitudeAngle || 1.5707963267948966, p.azimuthAngle || 0, x, y, 1 ];
          
          _originMatrix[ 2 ] = -view.origin.x;
          _originMatrix[ 5 ] = -view.origin.y;
          _positionMatrix[ 2 ] = view.origin.x;
          _positionMatrix[ 5 ] = view.origin.y;

          mul3x3( viewMatrices.current , _originMatrix , _inverter );
          mul3x3( _inverter , viewMatrices.moving , _inverter );
          mul3x3( _inverter , _positionMatrix , _inverter );
          inv( _inverter , _inverter );
          mul3x1( _inverter , point , point );

          painter.queue.push( point );
          if( uiSettings.isActiveTool( "paint" ) || uiSettings.isActiveTool( "mask" ) )
            paintGPU2( painter.queue ); //paints onto layer set in beginPaintGPU2
          else if( uiSettings.isActiveTool( "lasso" ) )
            updateLasso( painter.queue );
        }
    }
    
    if( pointers.active.hasOwnProperty( p.pointerId ) ) {
        pointers.active[ p.pointerId ].current.x = x;
        pointers.active[ p.pointerId ].current.y = y;
        if( pincher.current.a.id == p.pointerId ) {
            pincher.current.a.x = x;
            pincher.current.a.y = y;
        }
        if( pincher.current.b.id == p.pointerId ) {
            pincher.current.b.x = x;
            pincher.current.b.y = y;
        }
    }

    if( pointers.count === 0 ) {
      
      UI.updateHover( p );

    } else {

      UI.cancelHover();

    }

  return false;

}
const stopHandler = p => {
    cancelEvent( p );

    if( UI.pointerHandlers[ p.pointerId ] ) {
      UI.pointerHandlers[p.pointerId].end( p );
    }

    moveHandler( p, true );

    if( pointers.count === 1 ) {
        const point = [ cursor.current.x , cursor.current.y, 1 ];
        const { layerContainingPoint } = getSelectedOrBatchedLayerContainingPoint( point );

        if( uiSettings.isActiveTool( "flood-fill" ) && painter.active === false && cursor.mode === "none" && layerContainingPoint?.layerType === "paint" ) {
          //get our global coordinate
          
          _originMatrix[ 2 ] = -view.origin.x;
          _originMatrix[ 5 ] = -view.origin.y;
          _positionMatrix[ 2 ] = view.origin.x;
          _positionMatrix[ 5 ] = view.origin.y;

          mul3x3( viewMatrices.current , _originMatrix , _inverter );
          mul3x3( _inverter , viewMatrices.moving , _inverter );
          mul3x3( _inverter , _positionMatrix , _inverter );
          inv( _inverter , _inverter );
          mul3x1( _inverter , point , point );

          //cast to our layer
          
          //get our selected layer's space (I should really put this in some kind of function? It's so duplicated)
          let origin = { x:layerContainingPoint.topLeft[0], y:layerContainingPoint.topLeft[1] },
            xLeg = { x:layerContainingPoint.topRight[0] - origin.x, y: layerContainingPoint.topRight[1] - origin.y },
            xLegLength = Math.sqrt( xLeg.x**2 + xLeg.y**2 ),
            normalizedXLeg = { x:xLeg.x/xLegLength, y:xLeg.y/xLegLength },
            yLeg = { x:layerContainingPoint.bottomLeft[0] - origin.x, y: layerContainingPoint.bottomLeft[1] - origin.y },
            yLegLength = Math.sqrt( yLeg.x**2 + yLeg.y**2 ),
            normalizedYLeg = { x:yLeg.x/yLegLength, y:yLeg.y/yLegLength };

          let layerX, layerY;
          {
            let [x,y] = point;
            //translate from origin
            x -= origin.x; y -= origin.y;
            //project on normals
            let xProjection = x*normalizedXLeg.x + y*normalizedXLeg.y;
            let yProjection = x*normalizedYLeg.x + y*normalizedYLeg.y;
            //unnormalize
            xProjection *= layerContainingPoint.w / xLegLength;
            yProjection *= layerContainingPoint.h / yLegLength;
            layerX = parseInt( xProjection );
            layerY = parseInt( yProjection );
          }

          if( layerX >= 0 && layerY >= 0 && layerX <= layerContainingPoint.w && layerY <= layerContainingPoint.h )
            floodFillLayer( layerContainingPoint, layerX, layerY );
          
        }
        if( cursor.mode !== "none" ) {
            if( cursor.mode === "ui" ) {
              cursor.inUIRect.activate();
              delete cursor.inUIRect;
            } else {
              if( uiSettings.activeTool === "transform" && uiSettings.toolsSettings.transform.current === true ) {
                finalizeLayerTransform();
              } else {
                finalizeViewMove();
              }
            }
            cursor.origin.x = 0;
            cursor.origin.y = 0;
            cursor.current.x = 0;
            cursor.current.y = 0;
            cursor.mode = "none";
        }
        if( painter.active === true ) {
          if( uiSettings.isActiveTool( "paint" ) || uiSettings.isActiveTool( "mask" ) )
            finalizePaintGPU2();
          else if( uiSettings.isActiveTool( "lasso" ) )
            finalizeLasso();
          painter.active = false;
          painter.queue.length = 0;
        }
    }
    if( pointers.count === 2 && existsVisibleLayer()  ) {
        //we should delete both to end the event.
        if( uiSettings.activeTool === "transform" && uiSettings.toolsSettings.transform.current === true) {
          finalizeLayerTransform();
        } else {
          finalizeViewMove();
        }
        const [ idA , idB ] = Object.keys( pointers.active );
        delete pointers.active[ idA ];
        delete pointers.active[ idB ];
        pincher.origin.a.x = 0;
        pincher.origin.a.y = 0;
        pincher.origin.a.id = null;
        pincher.origin.b.x = 0;
        pincher.origin.b.y = 0;
        pincher.origin.b.id = null;
        pincher.origin.center.x = 0;
        pincher.origin.center.y = 0;
        pincher.origin.length = 0;
        pincher.origin.angle = 0;
        pincher.current.a.x = 0;
        pincher.current.a.y = 0;
        pincher.current.a.id = null;
        pincher.current.b.x = 0;
        pincher.current.b.y = 0;
        pincher.current.b.id = null;
    }

    delete pointers.active[ p.pointerId ];
    pointers.count = Object.keys( pointers.active ).length;

    return false;

}


function writeInfo() {
    ctx.fillStyle = "rgb(255,0,0)";
    ctx.font = "16px sans-serif";
    const lineHeight = 20;
    let y = 0;
    ctx.fillText( "Version " + VERSION , 10 , 10 + lineHeight * (y++) );
    ctx.fillText( "View: " + JSON.stringify( view ) , 10 , 10 + lineHeight * (y++) );
    ctx.fillText( "Pincher Origin: " + JSON.stringify( pincher.origin ) , 10 , 10 + lineHeight * (y++) );
    ctx.fillText( "Pincher Current: " + JSON.stringify( pincher.current ) , 10 , 10 + lineHeight * (y++) );
    ctx.fillText( "Pointers: " + JSON.stringify( pointers ) , 10 , 10 + lineHeight * (y++) );
    ctx.fillText( "Width / Height: " + W + " , " + H , 10 , 10 + lineHeight * (y++) );
    ctx.fillText( "Painter " + JSON.stringify( painter ) , 10 , 10 + lineHeight * (y++) );
    ctx.fillText( "Cursor Current: " + JSON.stringify( cursor ) , 10 , 10 + lineHeight * (y++) );
}

const view = {
    angle: 0,
    initialAngleOffset: 0,
    initialZoomLength: 1,
    zoom: 1,
    pan: { x: 0, y: 0 },
    origin: { x: 0 , y: 0 }
}
const layerTransform = {
  angle: 0,
  initialAngleOffset: 0,
  initialZoomLength: 1,
  zoom: 1,
  pan: { x: 0, y: 0 },
  origin: { x: 0 , y: 0 }
}
function updateCycle( t ) {
  if( pointers.count === 1 ) {
    if( uiSettings.activeTool === "transform" && uiSettings.toolsSettings.transform.current === true ) {
      if( cursor.mode === "none" ) return;
  
      if( cursor.mode === "pan" ) {
        layerTransform.origin.x = cursor.origin.x;
        layerTransform.origin.y = cursor.origin.y;
        layerTransform.pan.x = cursor.current.x - cursor.origin.x;
        layerTransform.pan.y = cursor.current.y - cursor.origin.y;
        mat( 1 , 0 , layerTransform.pan.x , layerTransform.pan.y , layerTransformMatrices.moving );
        UI.updateView();
      }
  
      if( cursor.mode === "zoom" ) {
        //need initial offset for zoom
        layerTransform.origin.x = cursor.origin.x;
        layerTransform.origin.y = cursor.origin.y;
  
        const dx = cursor.current.x - cursor.origin.x;
        const dy = cursor.current.y - cursor.origin.y;
        const d = Math.sqrt( dx**2 + dy**2 );
        layerTransform.zoom = d / layerTransform.initialZoomLength;

        if( uiSettings.lockTransformZoom === true ) layerTransform.zoom = 1;

        mat( layerTransform.zoom , 0 , 0 , 0 , layerTransformMatrices.moving );
        UI.updateView();
      }
  
      if( cursor.mode === "rotate" ) {
        //need initial offset of 0-angle to prevent rotate shuddering
        layerTransform.origin.x = cursor.origin.x;
        layerTransform.origin.y = cursor.origin.y;
        
        const dx = cursor.origin.x - cursor.current.x;
        const dy = cursor.origin.y - cursor.current.y;
  
        layerTransform.angle = Math.atan2( dy , dx ) + layerTransform.initialAngleOffset;

        if( uiSettings.lockTransformRotate === true ) layerTransform.angle = 0;

        mat( 1 , layerTransform.angle , 0 , 0 , layerTransformMatrices.moving );
        UI.updateView();
      }
    }
    else {
      if( cursor.mode === "none" ) return;
  
      if( cursor.mode === "pan" ) {
        view.origin.x = cursor.origin.x;
        view.origin.y = cursor.origin.y;
        view.pan.x = cursor.current.x - cursor.origin.x;
        view.pan.y = cursor.current.y - cursor.origin.y;
        mat( 1 , 0 , view.pan.x , view.pan.y , viewMatrices.moving );
        UI.updateView();
      }
  
      if( cursor.mode === "zoom" ) {
        //need initial offset for zoom
        view.origin.x = cursor.origin.x;
        view.origin.y = cursor.origin.y;
  
        const dx = cursor.current.x - cursor.origin.x;
        const dy = cursor.current.y - cursor.origin.y;
        const d = Math.sqrt( dx**2 + dy**2 );
        view.zoom = d / view.initialZoomLength;

        if( uiSettings.lockCanvasZoom === true ) view.zoom = 1;

        mat( view.zoom , 0 , 0 , 0 , viewMatrices.moving );
        UI.updateView();
      }
  
      if( cursor.mode === "rotate" ) {
        //need initial offset of 0-angle to prevent rotate shuddering
        view.origin.x = cursor.origin.x;
        view.origin.y = cursor.origin.y;
        
        const dx = cursor.origin.x - cursor.current.x;
        const dy = cursor.origin.y - cursor.current.y;
  
        view.angle = Math.atan2( dy, dx ) + view.initialAngleOffset;

        if( uiSettings.lockCanvasRotate === true || uiSettings.alwaysLockCanvasRotate === true ) view.angle = 0;

        mat( 1 , view.angle , 0 , 0 , viewMatrices.moving );
        UI.updateView();
      }
    }
  }
  if( pointers.count === 2 && existsVisibleLayer() ) {
    if( uiSettings.activeTool === "transform" && uiSettings.toolsSettings.transform.current === true ) {
      const a = pincher.current.a, 
          b = pincher.current.b;
      const dx = b.x - a.x, 
          dy = b.y - a.y,
          d = Math.sqrt( dx*dx + dy*dy ),
          angle = Math.atan2( dy , dx );
  
      const cx = ( a.x + b.x ) / 2,
          cy = ( a.y + b.y ) / 2;
  
      layerTransform.origin.x = pincher.origin.center.x;
      layerTransform.origin.y = pincher.origin.center.y;
      
      layerTransform.zoom = d / pincher.origin.length;

      if( uiSettings.lockTransformZoom === true ) layerTransform.zoom = 1;

      layerTransform.angle = angle - pincher.origin.angle;

      if( uiSettings.lockTransformRotate === true ) layerTransform.angle = 0;

      layerTransform.pan.x = cx - pincher.origin.center.x;
      layerTransform.pan.y = cy - pincher.origin.center.y;
      mat( layerTransform.zoom , layerTransform.angle , layerTransform.pan.x , layerTransform.pan.y , layerTransformMatrices.moving );
    }
    else {
      const a = pincher.current.a, 
          b = pincher.current.b;
      const dx = b.x - a.x, 
          dy = b.y - a.y,
          d = Math.sqrt( dx*dx + dy*dy ),
          angle = Math.atan2( dy , dx );
  
      const cx = ( a.x + b.x ) / 2,
          cy = ( a.y + b.y ) / 2;
  
      view.origin.x = pincher.origin.center.x;
      view.origin.y = pincher.origin.center.y;
      
      view.zoom = d / pincher.origin.length;

      if( uiSettings.lockCanvasZoom === true ) view.zoom = 1;

      view.angle = angle - pincher.origin.angle;

      if( uiSettings.lockCanvasRotate === true || uiSettings.alwaysLockCanvasRotate === true ) view.angle = 0;

      view.pan.x = cx - pincher.origin.center.x;
      view.pan.y = cy - pincher.origin.center.y;
      mat( view.zoom , view.angle , view.pan.x , view.pan.y , viewMatrices.moving );
      UI.updateView();
    }
  }
}

const _tpoint = [ 0 , 0 , 1 ],
    _transform = [
        1 , 0 , 0 ,
        0 , 1 , 0 ,
        0 , 0 , 1
    ],
    _layerTranform = [
      1 , 0 , 0 ,
      0 , 1 , 0 ,
      0 , 0 , 1
    ];

function getTransform() {
  _originMatrix[ 2 ] = -view.origin.x;
  _originMatrix[ 5 ] = -view.origin.y;
  _positionMatrix[ 2 ] = view.origin.x;
  _positionMatrix[ 5 ] = view.origin.y;

  mul3x3( viewMatrices.current , _originMatrix , _transform ); // origin * current
  mul3x3( _transform , viewMatrices.moving , _transform ); // (origin*current) * moving
  mul3x3( _transform , _positionMatrix , _transform ); // transform = ( (origin*current) * moving ) * position
}
function transformPoint( p ) {
  _tpoint[0] = p[0];
  _tpoint[1] = p[1];
  _tpoint[2] = p[2];
  
  mul3x1( _transform , _tpoint , _tpoint );

  return _tpoint;
}
function getLayerTransform() {
  _originMatrix[ 2 ] = -layerTransform.origin.x;
  _originMatrix[ 5 ] = -layerTransform.origin.y;
  _positionMatrix[ 2 ] = layerTransform.origin.x;
  _positionMatrix[ 5 ] = layerTransform.origin.y;

  mul3x3( layerTransformMatrices.current , _originMatrix , _layerTranform ); // origin * current
  mul3x3( _layerTranform , layerTransformMatrices.moving , _layerTranform ); // (origin*current) * moving
  mul3x3( _layerTranform , _positionMatrix , _layerTranform ); // transform = ( (origin*current) * moving ) * position
}
function transformLayerPoint( p ) {
  _tpoint[0] = p[0];
  _tpoint[1] = p[1];
  _tpoint[2] = p[2];
  
  mul3x1( _layerTranform , _tpoint , _tpoint );

  return _tpoint;
}


const paintGPUResources2 = {

  alphaLocked: 0,
  currentPaintingLayer: null,

  brushTipTexture: null,
  brushTipCanvas: document.createElement( "canvas" ),
  brushTextureTexture: null,
  lassoAreaTexture: null,
  currentLassoAreaTexture: null,
  invertLassoArea: false,

  blendSourceTexture: null, //this is a copy of the target layer

  renderTexture: null,
  depthTexture: null,
  framebuffer: null,

  //blend components
  indexInputIndex: null,
  indexBuffer: null,
  indices: null,
  indicesCount: 0,
  blendOriginsIndex: null,
  blendOriginsTexture: null,
  blendOriginsArray: [],
  blendHVLegsIndex: null,
  blendHVLegsTexture: null,
  blendHVLegsArray: [],

  //paint program components
  program: null,
  vao: null,
  vertices: null,
  vertexBuffer: null,
  xyuvInputIndex: null,
  rgbas: null,
  rgbaBuffer: null,
  rgbaIndex: null,
  miscs: null,
  miscBuffer: null,
  miscIndex: null,
  brushTipIndex: null,
  brushTextureIndex: null,
  blendSourceIndex: null,
  lassoAreaIndex: null,
  blendAlphaIndex: null,
  eraseAmountIndex: null,
  alphaLockedIndex: null,
  lassoAreaInvertIndex: null,
  
  modRect: {x:0,y:0,x2:0,y2:0,w:0,h:0},
  blendDistanceTraveled: 0,
  brushDistanceTraveled: 0,

  ready: false,
  starting: false,

}
function setupPaintGPU2() {
  //set up our shaders and renderbuffer
  //push some code to the GPU
  const vertexShaderSource = `#version 300 es
    in vec4 xyuv;
    in vec4 rgba;
    in vec4 misc;
    in int pointIndex;

    out vec2 brushTipUV;
    out vec2 blendUV;
    out vec4 paintColor;
    out vec4 miscData;
    flat out int pointBlendIndex;
    
    void main() {
      pointBlendIndex = pointIndex;
      brushTipUV = xyuv.zw;
      blendUV = xyuv.xy;
      paintColor = rgba;
      miscData = misc;
      gl_Position = vec4(xyuv.xy,rgba.a,1);
    }`;
  //gl_FragCoord: Represents the current fragment's window-relative coordinates and depth
  //gl_FrontFacing: Indicates if the fragment belongs to a front-facing geometric primitive
  //gl_PointCoord: Specifies the fragment's position within a point in the range 0.0 to 1.0
  //gl_FragColor: Represents the color of the fragment and is used to change the fragment's color
  
  const fragmentShaderSource = `#version 300 es
  precision highp float;
  
  uniform sampler2D brushTip;
  uniform sampler2D blendSource;
  uniform sampler2D blendOrigins;
  uniform sampler2D blendHVLegs;
  uniform sampler2D brushTexture;
  uniform sampler2D lassoArea;
  
  uniform float blendAlpha; //blendAlpha is a mixture ratio. 0=pure pigment; 1=pure blend
  uniform float eraseAmount;
  uniform int blendPull;
  uniform float alphaLocked;
  uniform int lassoAreaInvert;
  
  flat in int pointBlendIndex;
  in vec2 brushTipUV;
  in vec2 blendUV;
  in vec4 paintColor; //meanwhile, paint alpha (brush opacity) controls how much we change our base canvas
  in vec4 miscData;

  out vec4 outColor;
  
  vec4 blendLookup( vec2 uv ) {

    //accumulate into a vector
    vec4 blendColor = vec4(0.0);
  
    //start at pointBlendIndex
    //count down from pointBlendIndex to limit or zero
    float count = 0.0, totalCount = 0.0;
    for( int i = max( 0, ( pointBlendIndex - blendPull ) ), j = pointBlendIndex; i < j; i++ ) {
      //get our origin and legs 
      highp vec4 origin = texelFetch( blendOrigins, ivec2(i,0), 0 );
      highp vec4 hvLegs = texelFetch( blendHVLegs, ivec2(i,0), 0 );
      highp vec2 hLeg = hvLegs.xy;
      highp vec2 vLeg = hvLegs.zw;
      //get our coordinate along the trail
      vec2 blendTrailUV = ( ( origin.xy + (hLeg.xy * uv.x) + (vLeg.xy * uv.y) ) + 1.0 ) / 2.0;
      vec4 blendTrailLookup = texture( blendSource, blendTrailUV );
      if( blendTrailLookup.a == 0.0 ) continue;
      vec4 lassoLookup = texture( lassoArea, blendTrailUV );
      if( lassoLookup.a == 0.0 ) continue;
      //blendTrailLookup.a *= lassoLookup.a; //For now, we're just going binary exclude non-lassoed blend sources; no messing with their alpha
      count += 1.0;
      totalCount += count;
      blendColor += blendTrailLookup * count;
    }
  
    blendColor /= max( 1.0, totalCount );
  
    if( totalCount < 1.0 )
      blendColor.a = -1.0;
  
    return blendColor;
  
  }
  
  
  void main() {
  
    vec2 brushTipUV = brushTipUV.xy;
    float brushTextureWeight = miscData.x;
    vec2 brushTextureOffset = miscData.yz;

    vec2 brushTextureUV = vec2(
      mod( float( gl_FragCoord.x ) / 64.0, 1.0 ),
      mod( float( gl_FragCoord.y ) / 64.0, 1.0 )
    );

    vec4 brushTipLookup = texture( brushTip, brushTipUV );
    vec4 lassoAreaLookup = texture( lassoArea, ( blendUV + 1.0 ) / 2.0 );

    if( lassoAreaInvert == 1 ) {
      lassoAreaLookup.a = 1.0 - lassoAreaLookup.a;
    }

    vec4 brushTextureLookup = texture(
      brushTexture,
      vec2(
        mod( brushTextureUV.x + brushTextureOffset.x, 1.0 ),
        mod( brushTextureUV.y + brushTextureOffset.y, 1.0 )
      )
    );
    vec4 paint = vec4( paintColor.rgb, paintColor.a * brushTipLookup.a * lassoAreaLookup.a );
  
    //when my paint alpha nears zero, my brush textureweight is at its max
    //when my paint alpha nears one, my brush textureweight nears nothing
    brushTextureWeight = ( brushTextureWeight * 0.5 ) + ( brushTextureWeight * ( 1.0 - paint.a ) );

    float brushTextureValue = ( brushTextureWeight * brushTextureLookup.r ) + ( 1.0 - brushTextureWeight );

    //A 16 scenarios:
    if( paint.a == 0.0 ) discard;
  
    vec4 destLookup = texture( blendSource, ( blendUV + 1.0 ) / 2.0 );
  
    //B 8 scenarios:
    if( eraseAmount == 1.0 ) {
      //alphaLocked ignored for erase
      outColor = vec4(
          destLookup.rgb,
          destLookup.a * ( 1.0 - paint.a ) * ( 1.0 - brushTextureValue )
      );
      gl_FragDepth = paint.a;
      return;
    }
  
    //? ? scenarios not mapped for alphalocked
    if( alphaLocked == 1.0 && destLookup.a == 0.0 ) {
      discard;
    }

    //C 2 scenarios
    if( blendAlpha == 0.0 && destLookup.a == 0.0 ) {
      //if alphaLocked, already discarded
      outColor = vec4(
        paint.rgb,
        paint.a * brushTextureValue
      );
      gl_FragDepth = paint.a;
      return;
    }
  
    //D 2 scenarios:
    if( blendAlpha == 0.0 && destLookup.a > 0.0 ) {
      float totalOpacity = clamp( destLookup.a + ( paint.a * brushTextureValue ), 0.0, 1.0 );
      float paintWeight = ( paint.a * brushTextureValue ) / totalOpacity;
      float destWeight = ( totalOpacity - ( paint.a * brushTextureValue ) ) / totalOpacity;
      outColor = vec4(
          sqrt( ( paintWeight * pow( paint.r, 2.0 ) ) + ( destWeight * pow( destLookup.r, 2.0 ) ) ),
          sqrt( ( paintWeight * pow( paint.g, 2.0 ) ) + ( destWeight * pow( destLookup.g, 2.0 ) ) ),
          sqrt( ( paintWeight * pow( paint.b, 2.0 ) ) + ( destWeight * pow( destLookup.b, 2.0 ) ) ),
          mix( totalOpacity, destLookup.a, alphaLocked )
      );
      gl_FragDepth = paint.a;
      return;
    }
  
    vec4 blendLookup = blendLookup( brushTipUV.xy );
    float blendLookupA = blendLookup.a * paint.a;
    
    //I 1 scenario:
    if( blendAlpha == 1.0 && blendLookupA < 0.0 ) discard; // < 0.0 means no blend pixels accumulated during average step
  
    //H 1 scenario:
    if( blendAlpha == 1.0 && destLookup.a == 0.0 && blendLookup.a == 0.0 ) discard;
  
    //E 1 scenario:
    if( blendAlpha == 1.0 && destLookup.a == 0.0 && blendLookupA > 0.0 ) {
      //if alphaLocked, already discarded
      outColor = vec4(
          blendLookup.rgb,
          blendLookupA * brushTextureValue
      );
      gl_FragDepth = blendLookupA;
      return;
    }
  
    //F 1 scenario:
    /* if( blendAlpha == 1.0 && destLookup.a > 0.0 && blendLookupA > 0.0 ) {
      //float totalOpacity = clamp( destLookup.a + blendLookupA, 0.0, 1.0 );
      //float mixedOpacity = mix( destLookup.a, blendLookup.a, paint.a ); //new code, iffy theory

      float totalOpacity = clamp( destLookup.a + ( blendLookupA * paint.a ), 0.0, 1.0 );
      float blendWeight = ( blendLookupA * paint.a ) / totalOpacity;
      float destWeight = ( totalOpacity - ( blendLookupA * paint.a ) ) / totalOpacity;

      //float destWeight = 1.0 - blendWeight;

      outColor = vec4(
          sqrt( ( blendWeight * pow( blendLookup.r, 2.0 ) ) + ( destWeight * pow( destLookup.r, 2.0 ) ) ),
          sqrt( ( blendWeight * pow( blendLookup.g, 2.0 ) ) + ( destWeight * pow( destLookup.g, 2.0 ) ) ),
          sqrt( ( blendWeight * pow( blendLookup.b, 2.0 ) ) + ( destWeight * pow( destLookup.b, 2.0 ) ) ),
          totalOpacity
      );

      gl_FragDepth = blendLookupA;
      return;
    } */
    if( blendAlpha == 1.0 && destLookup.a > 0.0 && blendLookupA > 0.0 ) {
      //float totalOpacity = clamp( destLookup.a + blendLookupA, 0.0, 1.0 );
      float mixedOpacity = mix( destLookup.a, blendLookup.a, paint.a * brushTextureValue ); //new code, iffy theory
      float blendWeight = blendLookupA;
      float destWeight = 1.0 - blendWeight;
      outColor = vec4(
          sqrt( ( blendWeight * pow( blendLookup.r, 2.0 ) ) + ( destWeight * pow( destLookup.r, 2.0 ) ) ),
          sqrt( ( blendWeight * pow( blendLookup.g, 2.0 ) ) + ( destWeight * pow( destLookup.g, 2.0 ) ) ),
          sqrt( ( blendWeight * pow( blendLookup.b, 2.0 ) ) + ( destWeight * pow( destLookup.b, 2.0 ) ) ),
          mix( mixedOpacity, destLookup.a, alphaLocked )
      );
      gl_FragDepth = blendLookupA;
      return;
    }
  
    //G 1 scenario:
    if( blendAlpha == 1.0 && destLookup.a > 0.0 && blendLookupA == 0.0 ) {
      float mixedOpacity = mix( destLookup.a, blendLookup.a, paint.a * brushTextureValue ); //new code, iffy theory
      outColor = vec4(
          destLookup.rgb,
          mix( mixedOpacity, destLookup.a, alphaLocked )
      );
      gl_FragDepth = paint.a;
      return;
    }
  
    discard;
  
  }`;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader,vertexShaderSource);
    gl.compileShader(vertexShader);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader,fragmentShaderSource);
    gl.compileShader(fragmentShader);

    const program = gl.createProgram();
    gl.attachShader(program,vertexShader);
    gl.attachShader(program,fragmentShader);
    gl.linkProgram(program);
    paintGPUResources2.program = program;

    //console.log( "SetupPaintGPU shader compilation log: ", gl.getProgramInfoLog(program) );

    //set up a data-descriptor
    const vao = gl.createVertexArray();
    paintGPUResources2.vao = vao;
    gl.bindVertexArray(paintGPUResources2.vao);

    //push some vertex and UV data to the GPU; will update live
    const xyuvs = [
      //top-left triangle
      0,0, 0,0,
      1,0, 1,0,
      0,1, 0,1,
      //bottom-right triangle
      1,0, 1,0,
      1,1, 1,1,
      0,1, 0,1,
    ];
    const xyBuffer = gl.createBuffer();
    const xyuvInputIndex = gl.getAttribLocation( program, "xyuv" );
    paintGPUResources2.xyuvInputIndex = xyuvInputIndex;
    paintGPUResources2.vertexBuffer = xyBuffer;
    paintGPUResources2.vertices = xyuvs;
    gl.bindBuffer(gl.ARRAY_BUFFER,paintGPUResources2.vertexBuffer);
    gl.bufferData( gl.ARRAY_BUFFER, new Float32Array(paintGPUResources2.vertices), gl.STREAM_DRAW );

    //push a description of our vertex data's structure
    gl.enableVertexAttribArray( paintGPUResources2.xyuvInputIndex );
    {
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( paintGPUResources2.xyuvInputIndex, size, dType, normalize, stride, offset );
    }

    //this is color and opacity data (per-face color isn't entirely relevant ATM)
    const rgbas = [
      //top-left triangle
      0,0, 0,1,
      0,0, 0,1,
      0,0, 0,1,
      //bottom-right triangle
      0,0, 0,1,
      0,0, 0,1,
      0,0, 0,1,
    ];
    {
      const rgbaBuffer = gl.createBuffer();
      const rgbaInputIndex = gl.getAttribLocation( program, "rgba" );
      paintGPUResources2.rgbaIndex = rgbaInputIndex;
      paintGPUResources2.rgbaBuffer = rgbaBuffer;
      paintGPUResources2.rgbas = rgbas;
      gl.bindBuffer(gl.ARRAY_BUFFER,paintGPUResources2.rgbaBuffer);
      gl.bufferData( gl.ARRAY_BUFFER, new Float32Array(paintGPUResources2.rgbas), gl.STREAM_DRAW );
  
      //push a description of our vertex data's structure
      gl.enableVertexAttribArray( paintGPUResources2.rgbaIndex );
      {
        const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
        gl.vertexAttribPointer( paintGPUResources2.rgbaIndex, size, dType, normalize, stride, offset );
      }
    }

    //this is weight data and 3 unused
    {
      const misc = [
        //top-left triangle
        0,0, 0,0,
        0,0, 0,0,
        0,0, 0,0,
        //bottom-right triangle
        0,0, 0,0,
        0,0, 0,0,
        0,0, 0,0,
      ];
      {
        const miscBuffer = gl.createBuffer();
        const rgbaInputIndex = gl.getAttribLocation( program, "misc" );
        paintGPUResources2.miscIndex = rgbaInputIndex;
        paintGPUResources2.miscBuffer = miscBuffer;
        paintGPUResources2.miscs = misc;
        gl.bindBuffer(gl.ARRAY_BUFFER,paintGPUResources2.miscBuffer);
        gl.bufferData( gl.ARRAY_BUFFER, new Float32Array(paintGPUResources2.miscs), gl.STREAM_DRAW );
    
        //push a description of our vertex data's structure
        gl.enableVertexAttribArray( paintGPUResources2.miscIndex );
        {
          const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
          gl.vertexAttribPointer( paintGPUResources2.miscIndex, size, dType, normalize, stride, offset );
        }
      }
    }

    paintGPUResources2.indices = [ 0,0,0, 0,0,0 ];
    {
      paintGPUResources2.indexInputIndex = gl.getAttribLocation( program, "pointIndex" );
      paintGPUResources2.indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,paintGPUResources2.indexBuffer);
      gl.bufferData( gl.ARRAY_BUFFER, new Int32Array(paintGPUResources2.indices), gl.STREAM_DRAW );
  
      //push a description of our vertex data's structure
      gl.enableVertexAttribArray( paintGPUResources2.indexInputIndex );
      {
        const size = 1, dType = gl.INT, normalize=false, stride=0, offset=0;
        gl.vertexAttribPointer( paintGPUResources2.indexInputIndex, size, dType, normalize, stride, offset );
      }
    }

    paintGPUResources2.brushTipIndex = gl.getUniformLocation( paintGPUResources2.program, "brushTip" );
    paintGPUResources2.brushTextureIndex = gl.getUniformLocation( paintGPUResources2.program, "brushTexture" );
    paintGPUResources2.blendSourceIndex = gl.getUniformLocation( paintGPUResources2.program, "blendSource" );
    paintGPUResources2.lassoAreaIndex = gl.getUniformLocation( paintGPUResources2.program, "lassoArea" );

    paintGPUResources2.eraseAmountIndex = gl.getUniformLocation( paintGPUResources2.program, "eraseAmount" );
    paintGPUResources2.blendAlphaIndex = gl.getUniformLocation( paintGPUResources2.program, "blendAlpha" );
    paintGPUResources2.blendPullIndex = gl.getUniformLocation( paintGPUResources2.program, "blendPull" );
    paintGPUResources2.alphaLockedIndex = gl.getUniformLocation( paintGPUResources2.program, "alphaLocked" );
    paintGPUResources2.lassoAreaInvertIndex = gl.getUniformLocation( paintGPUResources2.program, "lassoAreaInvert" );
    
    paintGPUResources2.brushTipTexture = gl.createTexture();
    paintGPUResources2.brushTextureTexture = gl.createTexture();
    paintGPUResources2.blendSourceTexture = gl.createTexture();
    paintGPUResources2.lassoAreaTexture = gl.createTexture();
    
    paintGPUResources2.blendOriginsIndex = gl.getUniformLocation( paintGPUResources2.program, "blendOrigins" );
    paintGPUResources2.blendHVLegsIndex = gl.getUniformLocation( paintGPUResources2.program, "blendHVLegs" );
    paintGPUResources2.blendOriginsTexture = gl.createTexture();
    paintGPUResources2.blendHVLegsTexture = gl.createTexture();

    const framebuffer = gl.createFramebuffer();
    paintGPUResources2.framebuffer = framebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, paintGPUResources2.framebuffer);
     
    //set up the blank renderbuffer texture for rendering
    //Isn't this never used??? I'm rendering directly to the target layer.
    {
      paintGPUResources2.renderTexture = gl.createTexture();
      gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.renderTexture );
      const level = 0;
      const internalFormat = gl.RGBA;
      const layerWidth = 64;
      const layerHeight = 64;
      const border = 0;
      const format = gl.RGBA;
      const type = gl.UNSIGNED_BYTE;
      const data = null;
      gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, layerWidth, layerHeight, border, format, type, data);
     
      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // attach the texture as the first color attachment
      const attachmentPoint = gl.COLOR_ATTACHMENT0;
      gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, paintGPUResources2.renderTexture, level);
  
    }

    //set up the depth texture
    {
      gl.bindFramebuffer(gl.FRAMEBUFFER, paintGPUResources2.framebuffer);
      paintGPUResources2.depthTexture = gl.createTexture();
      gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.depthTexture );
      // define size and format of level 0
      const level = 0;
      const internalFormat = gl.DEPTH_COMPONENT24;
      const border = 0;
      const format = gl.DEPTH_COMPONENT;
      const type = gl.UNSIGNED_INT;
      const data = null;
      gl.texImage2D(gl.TEXTURE_2D, level, internalFormat,
                    64, 64, border,
                    format, type, data);

      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      //attach to framebuffer
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, paintGPUResources2.depthTexture, level);
    }

    //set up the lasso area texture
    {
      gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.lassoAreaTexture );
      // define size and format of level 0
      const level = 0;
      const internalFormat = gl.RGBA;
      const border = 0;
      const format = gl.RGBA;
      const type = gl.UNSIGNED_BYTE;
      const data = new Uint8ClampedArray([
        255,255,255,255, 255,255,255,255,
        255,255,255,255, 255,255,255,255,
      ]);
      gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, 2, 2, border, format, type, data );

      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    //set up the blend coordinate data textures
    for( const texture of [ paintGPUResources2.blendOriginsTexture, paintGPUResources2.blendHVLegsTexture ] ){
      gl.bindTexture( gl.TEXTURE_2D, texture )
      const level = 0;
      const internalFormat = gl.RGBA32F;
      const border = 0;
      const format = gl.RGBA;
      const type = gl.FLOAT;
      const data = null;
      gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, 64, 64, border, format, type, data);

      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    }


}
function beginPaintGPU2( layer ) {
  //set up GL textures and zero our distances traveled
  //set up the framebuffer/renderbuffer's size to match our destination canvas

  //if we're painting, blending, or erasing;
  //  always copy our source to our preview (and hide our source in loop draw)

  //const layer = selectedLayer;

  paintGPUResources2.currentPaintingLayer = layer;

  if( layer.alphaLocked === true ) paintGPUResources2.alphaLocked = 1;
  else paintGPUResources2.alphaLocked = 0;

  gl.bindVertexArray(paintGPUResources2.vao);

  if( uiSettings.activeTool === "mask" ) {
    if( layer.maskInitialized === false ) {
      //initialize the selected layer's mask if necessary
      if( uiSettings.toolsSettings.paint.modeSettings.erase.eraseAmount < 1 ) {
        //if we're starting painting with a positive stroke, clear the mask
        initializeLayerMask( layer, "transparent" );
      }
      if( uiSettings.toolsSettings.paint.modeSettings.erase.eraseAmount === 1 ) {
        //if we're starting with erase, solidify the mask
        initializeLayerMask( layer, "opaque" );
      }
    }
  }
  //
  const { w, h } = layer;

  //copy our paint layer to the blend source texture
  {

    gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.blendSourceTexture );
    const level = 0;
    //const internalFormat = gl.RGBA16F;
    const internalFormat = gl.RGBA;
    //const border = 0;
    const format = gl.RGBA;
    const type = gl.UNSIGNED_BYTE;
    //const type = gl.FLOAT;
    //const data = null;
    let blendImageSource; //blend beneath the mask is fine
    if( uiSettings.activeTool === "paint" ) blendImageSource = layer.canvas;
    if( uiSettings.activeTool === "mask" ) blendImageSource = layer.maskCanvas;

    //gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, w, h, border, format, type, data);
    gl.texImage2D( gl.TEXTURE_2D, level, internalFormat, format, type, blendImageSource );
   
    //no mipmaps (for now? could actually use for blur later probably)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  //set the dimensions of our depthtexture to match the layer
  {
    gl.bindFramebuffer(gl.FRAMEBUFFER, paintGPUResources2.framebuffer);
    gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.depthTexture );
    // define size and format of level 0
    const level = 0;
    const internalFormat = gl.DEPTH_COMPONENT24;
    const border = 0;
    const format = gl.DEPTH_COMPONENT;
    const type = gl.UNSIGNED_INT;
    const data = null;
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, w, h, border, format, type, data );

    //set filtering
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    //attach to framebuffer
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, paintGPUResources2.depthTexture, level);
    //gl.clearDepth( 0.0 );
    //gl.clear( gl.DEPTH_BUFFER_BIT );
    paintGPUResources2.starting = true;
  }

  //upload our brush tip texture
  {
    const brushTipImage = uiSettings.toolsSettings.paint.modeSettings.all.brushTipsImages[ 0 ];
    const brushTipCanvas = paintGPUResources2.brushTipCanvas;
    {
      //This blue code is a total mess, and the result is unusably bad. Seriously. I need to write it myself instead of relying on the browser's awful implementation.
      const { brushBlur, brushSize } = uiSettings.toolsSettings.paint.modeSettings.all;
      const blur = brushBlur * brushSize;
      let w = brushTipCanvas.width = brushSize + 6 * blur;
      let h = brushTipCanvas.height = brushSize * brushTipImage.height / brushTipImage.width + 6 * blur;
      let iw = brushSize, ih = brushSize * brushTipImage.height / brushTipImage.width;
      const btx = brushTipCanvas.getContext( "2d" );
      btx.save();
      btx.clearRect( 0, 0, w, h );
      btx.filter = "blur(" + blur + "px)";
      btx.translate( w/2 - iw/2, h/2 - ih/2 )
      for( let i=0, j=blur; i<=j; i++ )
        btx.drawImage( brushTipImage, i+Math.random()*3-1.5, i+Math.random()*3-1.5, iw-2*i, ih-2*i );
      btx.restore();
      //document.body.appendChild( brushTipCanvas );
      //brushTipCanvas.style = "position:absolute; left:20px; width:100px; border:1px solid red; background-color:white;";
    }
    gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.brushTipTexture );
    {
      const mipLevel = 0,
      internalFormat = gl.RGBA,
      srcFormat = gl.RGBA,
      srcType = gl.UNSIGNED_BYTE;
      gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, brushTipCanvas );
  
      //gl.generateMipmap( paintGPUResources.brushTipTexture );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  }

  //upload our brush texture texture
  {
    const brushTextureImage = uiSettings.toolsSettings.paint.modeSettings.all.brushTexturesImages[ 0 ];
    gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.brushTextureTexture );
    {
      const mipLevel = 0,
      internalFormat = gl.RGBA,
      srcFormat = gl.RGBA,
      srcType = gl.UNSIGNED_BYTE;
      gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, brushTextureImage );
  
      //gl.generateMipmap( paintGPUResources.brushTipTexture );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  }

  //upload our lasso area texture
  {
    const lassoLayer = getLassoLayerForLayer( layer );
    if( lassoLayer === null ) {
      paintGPUResources2.currentLassoAreaTexture = null;
      paintGPUResources2.invertLassoArea = false;
      const mipLevel = 0,
      internalFormat = gl.RGBA,
      width = 2,
      height = 2,
      border = 0,
      srcFormat = gl.RGBA,
      srcType = gl.UNSIGNED_BYTE;
      const data = new Uint8ClampedArray( [
        255,255,255,255, 255,255,255,255,
        255,255,255,255, 255,255,255,255,
      ] )
      gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, width, height, border, srcFormat, srcType, data );
  
      //gl.generateMipmap( paintGPUResources.brushTipTexture );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      paintGPUResources2.currentLassoAreaTexture = lassoLayer.glTexture;
      paintGPUResources2.invertLassoArea = lassoLayer.invert;
      gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.currentLassoAreaTexture );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  }

  //reset our point histories arrays
  paintGPUResources2.blendOriginsArray.length = 0;
  paintGPUResources2.blendHVLegsArray.length = 0;
  paintGPUResources2.indicesCount = 0;

  //reset our modrect
  //modRect: {x:0,y:0,x2:0,y2:0,w:0,h:0},
  const { modRect } = paintGPUResources2;
  modRect.x = Infinity;
  modRect.y = Infinity;
  modRect.x2 = -Infinity;
  modRect.y2 = -Infinity;
  modRect.w = 0;
  modRect.h = 0;

  //reset our distance traveled
  paintGPUResources2.brushDistanceTraveled = 0;

}
function paintGPU2( points ) {

  const layer = paintGPUResources2.currentPaintingLayer;

  if( points.length < 4 ) return; //spline interpolating, minimum 3

  //const layer = selectedLayer;

  const { alphaLocked } = paintGPUResources2;
  const settings = uiSettings.toolsSettings.paint.modeSettings;
  const { brushTipsImages, brushAspectRatio, brushTiltScale, brushTiltMinAngle, brushSize, brushOpacity, brushBlur, brushSpacing } = settings.all;
  const colorRGB = settings.brush.colorModes[ settings.brush.colorMode ].getRGBFloat();
  //const { blendBlur, reblendSpacing, reblendAlpha } = settings.blend;
  const { blendPull, blendAlpha } = settings.blend;
  const { eraseAmount } = settings.erase;
  const { modRect } = paintGPUResources2;

  const scaledBrushSize = brushSize * 1;

  //const reblendLength = reblendSpacing * scaledBrushSize;

  let [refX,refY,ref_,refPressure,refAltitudeAngle,refAzimuthAngle] = points[ points.length-4 ],
    [ax,ay,a_,aPressure,aAltitudeAngle,aAzimuthAngle] = points[ points.length-3 ],
    [bx,by,b_,bPressure,bAltitudeAngle,bAzimuthAngle] = points[ points.length-2 ],
    [toX,toY,to_,toPressure,toAltitudeAngle,toAzimuthAngle] = points[ points.length-1 ];

  if( toPressure === refPressure && refPressure === bPressure && bPressure === aPressure && aPressure === 0.5 ) {
    //iffy pressure not supported signature (hopefully this doesn't bug anything out...)
    aAzimuthAngle = bAzimuthAngle = refAzimuthAngle = Math.PI/4;
    aPressure = bPressure = refPressure = aAltitudeAngle = bAltitudeAngle = refAltitudeAngle = 1;
  }
  
  if( bPressure === 0 || toPressure === 0 ) return; //A stroke can't end on a zero.

  //transform our basis points  
  getTransform();

  let [canvasOriginX,canvasOriginY] = layer.topLeft,
    [xLegX,xLegY] = layer.topRight,
    [yLegX,yLegY] = layer.bottomLeft;
  xLegX -= canvasOriginX; xLegY -= canvasOriginY;
  yLegX -= canvasOriginX; yLegY -= canvasOriginY;
  const lengthXLeg = Math.sqrt( xLegX*xLegX + xLegY*xLegY ),
    lengthYLeg = Math.sqrt( yLegX*yLegX + yLegY*yLegY );
  xLegX /= lengthXLeg; xLegY /= lengthXLeg;
  yLegX /= lengthYLeg; yLegY /= lengthYLeg;

  let [globalTransformAx,globalTransformAy] = [ax,ay],
    [globalTransformBx,globalTransformBy] = [bx,by],
    [globalTransformRefx,globalTransformRefy] = [refX,refY],
    [globalTransformTox,globalTransformToy] = [toX,toY];
  //we have points in the same global coordinate system as our canvas.

  //transform from canvas origin
  globalTransformRefx -= canvasOriginX;
  globalTransformRefy -= canvasOriginY;
  globalTransformAx -= canvasOriginX;
  globalTransformAy -= canvasOriginY;
  globalTransformBx -= canvasOriginX;
  globalTransformBy -= canvasOriginY;
  globalTransformTox -= canvasOriginX;
  globalTransformToy -= canvasOriginY;

  //cast to canvas space by projecting on legs
  let canvasTransformRefx = globalTransformRefx*xLegX + globalTransformRefy*xLegY,
    canvasTransformRefy = globalTransformRefx*yLegX + globalTransformRefy*yLegY;
  canvasTransformRefx *= layer.w / lengthXLeg;
  canvasTransformRefy *= layer.h / lengthYLeg;
  let canvasTransformAx = globalTransformAx*xLegX + globalTransformAy*xLegY,
    canvasTransformAy = globalTransformAx*yLegX + globalTransformAy*yLegY;
  canvasTransformAx *= layer.w / lengthXLeg;
  canvasTransformAy *= layer.h / lengthYLeg;
  let canvasTransformBx = globalTransformBx*xLegX + globalTransformBy*xLegY,
    canvasTransformBy = globalTransformBx*yLegX + globalTransformBy*yLegY;
  canvasTransformBx *= layer.w / lengthXLeg;
  canvasTransformBy *= layer.h / lengthYLeg;
  let canvasTransformTox = globalTransformTox*xLegX + globalTransformToy*xLegY,
    canvasTransformToy = globalTransformTox*yLegX + globalTransformToy*yLegY;
  canvasTransformTox *= layer.w / lengthXLeg;
  canvasTransformToy *= layer.h / lengthYLeg;

  const pixelSpacing = Math.max( 1, brushSpacing * scaledBrushSize );
  //this lineLength is no longer accurate because of our spline interpolation tho...
  const lineSegmentCanvasPixelLength = Math.sqrt( (canvasTransformAx-canvasTransformBx)**2 + (canvasTransformAy-canvasTransformBy)**2 );
  const lineLength = Math.max( 1, parseInt( lineSegmentCanvasPixelLength / pixelSpacing ) );

  const tangentLength = lineLength * 0.33;

  let
    ref2b = [ (  canvasTransformBx - canvasTransformRefx ), ( canvasTransformBy - canvasTransformRefy ) ],
    //ref2b = [ (  canvasTransformAx - canvasTransformRefx ), ( canvasTransformAy - canvasTransformRefy ) ],
    ref2bLength = Math.sqrt( ref2b[0]**2 + ref2b[1]**2 ),
    to2a = [ ( canvasTransformAx - canvasTransformTox ), ( canvasTransformAy - canvasTransformToy ) ],
    //to2a = [ ( canvasTransformBx - canvasTransformTox ), ( canvasTransformBy - canvasTransformToy ) ],
    to2aLength = Math.sqrt( to2a[0]**2 + to2a[1]**2 ),
    aUnitTangent = [ ref2b[0] / ref2bLength, ref2b[1] / ref2bLength ], //a's tangent pointing forward
    bUnitTangent = [ to2a[0] / to2aLength, to2a[1] / to2aLength ]; //b's tangent pointing backward

  const cp1x = canvasTransformAx + aUnitTangent[0] * tangentLength, cp1y = canvasTransformAy + aUnitTangent[1] * tangentLength,
    cp2x = canvasTransformBx + bUnitTangent[0] * tangentLength, cp2y = canvasTransformBy + bUnitTangent[1] * tangentLength;


  //Here, we would reblend in the CPU format, but that's a separate draw call on the same set of verts, so it moves down the line

  paintGPUResources2.brushDistanceTraveled += lineLength;
  
  if( false && paintGPUResources2.brushDistanceTraveled < pixelSpacing ) {
    //No paint yet. This is important; we're still wrestling with alpha-accumulation even on the GPU.
    //(And we should be. That's what physical media does. IP's no-fog painting is unnatural. Hmm... But is unnatural better???)
    return;
  }

  //get our brush color
  let currentRGBFloat = [0,0,0];
  if( uiSettings.isActiveTool( "mask" ) ) {
    //currentColorStyle = uiSettings.toolsSettings.mask.maskColor;
    currentRGBFloat = [ ...uiSettings.toolsSettings.mask.maskRGBFloat ];
  }
  if( uiSettings.isActiveTool( "paint" ) ) {
    //currentColorFloat = [ ...colorRGB, 1.0 ];
    currentRGBFloat = [ ...colorRGB ]; //multiply brushOpacity by relevant opacity curves later
  }


  //compute our points
  const vertices = paintGPUResources2.vertices; //this is just a JS array
  vertices.length = 0;
  const rgbas = paintGPUResources2.rgbas;
  rgbas.length = 0;
  const miscs = paintGPUResources2.miscs;
  miscs.length = 0;
  const indices = paintGPUResources2.indices;
  //the blend data buffers are cumulative, and indicesCount is cumulative,
  //but the indices we upload to the GPU each draw call are reset each draw call
  indices.length = 0;
  const { blendOriginsArray, blendHVLegsArray } = paintGPUResources2;

  //vector math and draw calls
  {
    const [ crf, cgf, cbf ] = currentRGBFloat;

    //but basically, pointStep should be decided based on pixelSpacing?

    for( let i = 0; i<lineLength; i+=0.5 ) {
      //get our interpolation, linear for now to see how it looks
      let fr = i / lineLength,
        f = 1 - fr;

      //interpolate from a to b through our 2 control points
      let paintX = canvasTransformAx*(f**3) + 3*cp1x*(f**2)*(fr) + 3*cp2x*(f)*(fr**2) + canvasTransformBx*(fr**3),
        paintY = canvasTransformAy*(f**3) + 3*cp1y*(f**2)*(fr) + 3*cp2y*(f)*(fr**2) + canvasTransformBy*(fr**3);

      //TODO: spline interpolate pressure and angles!
      //linearly interpolate our pressure and angles
      let paintPressure = bPressure*fr + aPressure*f,
        altitudeAngle = bAltitudeAngle*fr + aAltitudeAngle*f, //against screen z-axis
        azimuthAngle = bAzimuthAngle*fr + aAzimuthAngle*f; //around screen, direction pointing
        //normalizedAltitudeAngle = 1 - ( altitudeAngle / 1.5707963267948966 ); //0 === perpendicular, 1 === parallel

      //when interpreting azimuth angle, we can't slerp from 6 -> 0.1 the long way, rather 6 -> 6.1
      if( Math.abs( bAzimuthAngle - aAzimuthAngle ) > 3.141 ) {
        if( bAzimuthAngle < aAzimuthAngle ) {
          bAzimuthAngle += 6.284;
          azimuthAngle = bAzimuthAngle*fr + aAzimuthAngle*f;
        } else {
          aAzimuthAngle += 6.284;
          azimuthAngle = bAzimuthAngle*fr + aAzimuthAngle*f;
        }
      }

      //we're adding our current view angle
      azimuthAngle += Math.atan2( viewMatrices.current[ 1 ], viewMatrices.current[ 0 ] );
    
      //altitude ranges from PI/2 (vertical over tablet) to ~0.67 (as flat against tablet as can register)
      //we're going to map it from 0 (vertical over tablet) to 1 (as flat as can register ~0.67)
      const invertAltitudeAngle = ( Math.PI/2 - altitudeAngle ); //0 vertical to about 0.90 max tilt
      const normalizedAltitudeAngle = Math.min( 1, ( invertAltitudeAngle / 0.90 ) ); //0 to 1 (maybe a little less)

      let clippedAngle;
      if( brushTiltMinAngle === 1 ) clippedAngle = 0;
      else if( normalizedAltitudeAngle < brushTiltMinAngle ) clippedAngle = 0;
      else clippedAngle = ( normalizedAltitudeAngle - brushTiltMinAngle ) / ( 1.0 - brushTiltMinAngle );
      
      let tiltScale = clippedAngle * brushTiltScale;

      const pointPressure = uiSettings.toolsSettings.paint.modeSettings.all.pressureScaleCurve( paintPressure );
      let scaledBrushSize = brushSize * pointPressure * ( 1 + 1*brushBlur );
      let scaledOpacity = brushOpacity * uiSettings.toolsSettings.paint.modeSettings.all.pressureOpacityCurve( paintPressure );
      let scaledTextureWeight = uiSettings.toolsSettings.paint.modeSettings.all.pressureTextureCurve( paintPressure );
  
      //our brush size in canvas pixels (this should probably be global pixels: scale again by layer canvas's scale)
      const tipImageWidth = paintGPUResources2.brushTipCanvas.width,
      tipImageHeight = paintGPUResources2.brushTipCanvas.height;
      const scaledTipImageWidth = scaledBrushSize * ( 1 + tiltScale ),
        scaledTipImageHeight = scaledBrushSize * tipImageHeight / tipImageWidth;

      //if the pen is very vertical, we want to center the brush
      //as it leaves verticaliy, we want to offset it
      //when angle === 0, center: xOffset = 0
      //as soon as angle > 0, jump(ish) to the left-most edge of the image, minus the blur
      let xOffset;
      if( clippedAngle === 0 || brushTiltScale === 0 ) xOffset = 0;
      else xOffset = ( scaledTipImageWidth/2 ) - Math.min( 1.0, clippedAngle*10 ) * ( 0.5 * brushBlur * scaledTipImageWidth );


      //compute our verts
      {
        //rotate by azimuthAngle  
        //get our unit transform legs

        let hLegUX = Math.cos( azimuthAngle ), hLegUY = Math.sin( azimuthAngle );
        let vLegUX = hLegUY, vLegUY = -hLegUX;

        //scale our transform legs up to canvas pixel dimensions
        let hLegX = hLegUX * scaledTipImageWidth, hLegY = hLegUY * scaledTipImageWidth;
        let vLegX = vLegUX * scaledTipImageHeight, vLegY = vLegUY * scaledTipImageHeight;
        //origin is paintX, paintY
        //transform our origin along the hLeg by the offset (in pixels)
        paintX += hLegUX * xOffset;
        paintY += hLegUY * xOffset;
        
        //now we can compute each vertex by translating from our origin along each leg half its distance
        //first, scale our legs down
        hLegX /= 2; hLegY /= 2;
        vLegX /= 2; vLegY /= 2;
          
        //transform our canvas points to GL points
        let iw = 2 / layer.w,
          ih = 2 / layer.h;

        const x1 = (paintX - hLegX - vLegX), x2 = (paintX + hLegX - vLegX), x3 = (paintX - hLegX + vLegX), x4 = (paintX + hLegX + vLegX),
        y1 = (paintY - hLegY - vLegY), y2 = (paintY + hLegY - vLegY), y3 = (paintY - hLegY + vLegY), y4 = (paintY + hLegY + vLegY);

        //update our mod rect
        modRect.x = Math.min( modRect.x, x1, x2, x3, x4 );
        modRect.y = Math.min( modRect.y, y1, y2, y3, y4 );
        modRect.x2 = Math.max( modRect.x2, x1, x2, x3, x4 );
        modRect.y2 = Math.max( modRect.y2, y1, y2, y3, y4 );

        const xyuvs = [
          //top-left triangle
          x1 * iw - 1, y1 * ih - 1, 0,0,
          x2 * iw - 1, y2 * ih - 1, 1,0,
          x3 * iw - 1, y3 * ih - 1, 0,1,
          //bottom-right triangle
          x2 * iw - 1, y2 * ih - 1, 1,0,
          x4 * iw - 1, y4 * ih - 1, 1,1,
          x3 * iw - 1, y3 * ih - 1, 0,1,
        ];

        vertices.push( ...xyuvs );

        //push our color data
        const colors = [
          //top-left triangle
          crf, cgf, cbf, scaledOpacity,
          crf, cgf, cbf, scaledOpacity,
          crf, cgf, cbf, scaledOpacity,
          //bottom-right triangle
          crf, cgf, cbf, scaledOpacity,
          crf, cgf, cbf, scaledOpacity,
          crf, cgf, cbf, scaledOpacity,
        ];

        rgbas.push( ...colors );

        const textureXOffset = Math.random(),
          textureYOffset = Math.random();

        const weights = [
          //top-left triangle
          scaledTextureWeight, textureXOffset,textureYOffset, 0,
          scaledTextureWeight, textureXOffset,textureYOffset, 0,
          scaledTextureWeight, textureXOffset,textureYOffset, 0,
          //bottom-right triangle
          scaledTextureWeight, textureXOffset,textureYOffset, 0,
          scaledTextureWeight, textureXOffset,textureYOffset, 0,
          scaledTextureWeight, textureXOffset,textureYOffset, 0,
        ];

        miscs.push( ...weights );

        //push the point index for this point
        const pointIndex = paintGPUResources2.indicesCount;
        indices.push(
          pointIndex, pointIndex, pointIndex,
          pointIndex, pointIndex, pointIndex
        );
        paintGPUResources2.indicesCount += 1;

        //push the coordinate space for this point
        blendOriginsArray.push( xyuvs[0],xyuvs[1], 0,0 ); //two unused slots
        blendHVLegsArray.push( xyuvs[4]-xyuvs[0],xyuvs[5]-xyuvs[1] , xyuvs[8]-xyuvs[0],xyuvs[9]-xyuvs[1] );

      }

    }

  }

  //execute the paint pass render
  {
    gl.useProgram( paintGPUResources2.program );
  
    //vertex array buffer (I'm still very unclear on what this does. What general info does it bind, exactly?)
    //probably just the vertexAttribArray definitions.
    gl.bindVertexArray(paintGPUResources2.vao);
  
    //bind our layer as the color attachment for the framebuffer
    {
      let sourceTexture;
      if( uiSettings.isActiveTool( "paint" ) ) sourceTexture = layer.glTexture;
      if( uiSettings.isActiveTool( "mask" ) ) sourceTexture = layer.glMask;
      gl.bindTexture( gl.TEXTURE_2D, sourceTexture );
      gl.bindFramebuffer(gl.FRAMEBUFFER, paintGPUResources2.framebuffer);
      
      // attach the texture as the first color attachment
      const attachmentPoint = gl.COLOR_ATTACHMENT0;
      const level = 0;
      gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, sourceTexture, level);
  
      //rebind the depth attachment while we're at it I guess
      //attach to framebuffer
      gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.depthTexture );
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, paintGPUResources2.depthTexture, level);
  
    }
  
    //bind the paint framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, paintGPUResources2.framebuffer);
    //set the viewport
    gl.viewport( 0, 0, layer.w, layer.h );
    
    //Let lower alpha be clipped by higher alpha paint.
    gl.enable( gl.DEPTH_TEST );
    gl.depthFunc( gl.GREATER );

    if( paintGPUResources2.starting === true ) {
      //Not actually sure about this depth-clear. If we get rim-glitches spaced far apart, this is probably why.
      paintGPUResources2.starting = false;
      //gl.clearDepth( 0.0 );
      //gl.clear( gl.DEPTH_BUFFER_BIT );
    }
    
    //disable blend, will blend inside shader
    gl.disable( gl.BLEND );
  
    //upload our xyuv points
    {
      gl.bindBuffer(gl.ARRAY_BUFFER,paintGPUResources2.vertexBuffer);
      gl.bufferData( gl.ARRAY_BUFFER, new Float32Array( vertices ), gl.STREAM_DRAW );
      //Do we need to reupload this description of our vertex data's structure? Did VAO keep it? Or did we lose it on rebuffering?
      gl.enableVertexAttribArray( paintGPUResources2.xyuvInputIndex );
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( paintGPUResources2.xyuvInputIndex, size, dType, normalize, stride, offset );
    }
  
    //upload our colors
    {
      gl.bindBuffer(gl.ARRAY_BUFFER,paintGPUResources2.rgbaBuffer);
      gl.bufferData( gl.ARRAY_BUFFER, new Float32Array( rgbas ), gl.STREAM_DRAW );
      //Do we need to reupload this description of our vertex data's structure? Did VAO keep it? Or did we lose it on rebuffering?
      gl.enableVertexAttribArray( paintGPUResources2.rgbaIndex );
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( paintGPUResources2.rgbaIndex, size, dType, normalize, stride, offset );
    }
  
    //upload our miscs
    {
      gl.bindBuffer(gl.ARRAY_BUFFER,paintGPUResources2.miscBuffer);
      gl.bufferData( gl.ARRAY_BUFFER, new Float32Array( miscs ), gl.STREAM_DRAW );
      //Do we need to reupload this description of our vertex data's structure? Did VAO keep it? Or did we lose it on rebuffering?
      gl.enableVertexAttribArray( paintGPUResources2.miscIndex );
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( paintGPUResources2.miscIndex, size, dType, normalize, stride, offset );
    }
  
    //upload our indices
    {
      gl.bindBuffer(gl.ARRAY_BUFFER,paintGPUResources2.indexBuffer);
      gl.bufferData( gl.ARRAY_BUFFER, new Int32Array( indices ), gl.STREAM_DRAW );
      //Do we need to reupload this description of our vertex data's structure? Did VAO keep it? Or did we lose it on rebuffering?
      gl.enableVertexAttribArray( paintGPUResources2.indexInputIndex );
      const size = 1, dType = gl.INT, stride=0, offset=0;
      gl.vertexAttribIPointer( paintGPUResources2.indexInputIndex, size, dType, stride, offset );
    }
  
    //set our tip as the tip texture (index 0)
    gl.activeTexture( gl.TEXTURE0 + 0 );
    gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.brushTipTexture );
    gl.uniform1i( paintGPUResources2.brushTipIndex, 0 );
  
    //set our blend source as the blend source texture (index 1)
    gl.activeTexture( gl.TEXTURE0 + 1 );
    gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.blendSourceTexture );
    gl.uniform1i( paintGPUResources2.blendSourceIndex, 1 );

    //upload our blend origin and legs textures
    let textureIndex = 2; //2 and 3
    for( const mode of [ "blendOrigins", "blendHVLegs" ] ) {
      const texture = paintGPUResources2[ mode + "Texture" ],
        data = paintGPUResources2[ mode + "Array" ];

      gl.activeTexture( gl.TEXTURE0 + textureIndex );
      gl.bindTexture( gl.TEXTURE_2D, texture );
      gl.uniform1i( paintGPUResources2[ mode + "Index" ], textureIndex );

      const level = 0;
      const internalFormat = gl.RGBA32F;
      const border = 0;
      const format = gl.RGBA;
      const type = gl.FLOAT;
      gl.texImage2D( gl.TEXTURE_2D, level, internalFormat, data.length/4, 1, border, format, type, new Float32Array(data) );

      //set filtering
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      textureIndex += 1;
    }
    
    //set our brush texture as the texture texture (index 4)
    gl.activeTexture( gl.TEXTURE0 + 4 );
    gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.brushTextureTexture );
    gl.uniform1i( paintGPUResources2.brushTextureIndex, 4 );
    
    //set our lasso area texture as the texture texture (index 5)
    gl.activeTexture( gl.TEXTURE0 + 5 );
    if( paintGPUResources2.currentLassoAreaTexture === null ) {
      gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.lassoAreaTexture );
    } else {
      gl.bindTexture( gl.TEXTURE_2D, paintGPUResources2.currentLassoAreaTexture );
    }
    gl.uniform1i( paintGPUResources2.lassoAreaIndex, 5 );
  
    //set our blend alpha
    gl.uniform1f( paintGPUResources2.blendAlphaIndex, blendAlpha );
    //set our erase amount
    gl.uniform1f( paintGPUResources2.eraseAmountIndex, eraseAmount );
    //set our blend pull (this is in points, as per spacing)
    gl.uniform1i( paintGPUResources2.blendPullIndex, blendPull );
    //set our alphaLocked
    gl.uniform1f( paintGPUResources2.alphaLockedIndex, alphaLocked );
    //set our lasso area invert
    gl.uniform1i( paintGPUResources2.lassoAreaInvertIndex, paintGPUResources2.invertLassoArea );

    //draw the triangles
    {
      const primitiveType = gl.TRIANGLES,
        structStartOffset = 0,
        structCount = vertices.length / 4;
      gl.drawArrays( primitiveType, structStartOffset, structCount );
    }
  
  }
  
}
function finalizePaintGPU2() {
  
  const layer = paintGPUResources2.currentPaintingLayer;

  //readpixels for our modrect from the old gltexture and this new one,
  //store those pixels in the undo buffer
  //put those pixels in a dataimage and blit onto the layer's preview canvas

  let affectedTexture, affectedContext, uninitializeMask = false;
  if( uiSettings.isActiveTool( "paint" ) ) {
    affectedTexture = layer.glTexture;
    affectedContext = layer.context;
  }
  if( uiSettings.isActiveTool( "mask" ) ) {
    affectedTexture = layer.glMask;
    affectedContext = layer.maskContext;
    if( layer.maskUnpainted === true ) {
      uninitializeMask = true;
      layer.maskUnpainted = false;
    }
  }

  //bind our framebuffer
  gl.bindFramebuffer( gl.FRAMEBUFFER, paintGPUResources2.framebuffer );
  //set the viewport
  gl.viewport( 0, 0, layer.w, layer.h );
  gl.bindTexture( gl.TEXTURE_2D, affectedTexture );
  gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, affectedTexture, 0 );


  const { modRect } = paintGPUResources2;
  //discretize our modrect
  modRect.x = Math.max( 0, parseInt( modRect.x || 0 ) ) || 0;
  modRect.y = Math.max( 0, parseInt( modRect.y || 0 ) ) || 0;
  modRect.x2 = Math.min( layer.w, parseInt( modRect.x2 || layer.w ) + 1 ) || layer.w;
  modRect.y2 = Math.min( layer.h, parseInt( modRect.y2 || layer.h ) + 1 ) || layer.h;
  //get our modrect width and height
  modRect.w = Math.max( 0, Math.min( layer.w, (modRect.x2 - modRect.x) || layer.w ) );
  modRect.h = Math.max( 0, Math.min( layer.h, (modRect.y2 - modRect.y) || layer.h ) );

  //hopefully replaced NaNs with full-layer blit op
  if( isNaN( modRect.x ) || isNaN( modRect.y ) || isNaN( modRect.x2 ) || isNaN( modRect.y2 ) || isNaN( modRect.w ) || isNaN( modRect.h ) || modRect.w === 0 || modRect.h === 0 ) {
    //nothing to update
    //console.error( "NaN rect.", modRect );
    return;
  }
  if( modRect.w === 0 || modRect.h === 0 ) {
    //nothing to update
    return;
  }

  //get our old data
  const oldData = affectedContext.getImageData( modRect.x, modRect.y, modRect.w, modRect.h );

  //make our readbuffer... I wonder if I could read straight to a dataimage. Hmm.
  //const readBuffer = new Uint8Array( modRect.w * modRect.h * 4 );
  //why isn't this y-reversed??? The main canvas framebuffer is reversed when I sample for the color picker... :-/
  //gl.readPixels( modRect.x, layer.h - modRect.y, modRect.w, modRect.h, gl.RGBA, gl.UNSIGNED_BYTE, readBuffer );
  const newData = affectedContext.createImageData( modRect.w, modRect.h );
  gl.readPixels( modRect.x, modRect.y, modRect.w, modRect.h, gl.RGBA, gl.UNSIGNED_BYTE, newData.data );
  affectedContext.putImageData( newData, modRect.x, modRect.y );

  //transfer to an imagedata
  //newData.data.set( readBuffer );

  //put the new imagedata onto the texture (since it's still just on the GPU)

  //call flag texture changed because this triggers upstream changes
  if( uiSettings.isActiveTool( "mask" ) ) {
    flagLayerMaskChanged( layer, modRect );
    layer.maskChanged = false; //but don't reupload to gpu; no need
  }
  else {
    //flagLayerTextureChanged( layer, modRect ); //Disabling frame update for performance. Hmm. Need to schedule for a lull, I guess???
    flagLayerTextureChanged( layer, modRect, false );
    updateFrameOnLull( layer );
    layer.textureChanged = false; //but don't reupload to gpu; no need
  }

  const historyEntry = {
    targetLayer: layer,
    affectedContext,
    isMask: uiSettings.isActiveTool( "mask" ),
    uninitializeMask,
    maskInitializedState: layer.maskInitializedState,
    oldData,
    newData,
    at: { x:modRect.x, y:modRect.y },
    undo: () => {
      historyEntry.affectedContext.putImageData( historyEntry.oldData, historyEntry.at.x, historyEntry.at.y );
      if( historyEntry.isMask === true ) {
        if( historyEntry.uninitializeMask ) uninitializeLayerMask( historyEntry.targetLayer );
        flagLayerMaskChanged( historyEntry.targetLayer );
      }
      if( historyEntry.isMask === false ) flagLayerTextureChanged( historyEntry.targetLayer );
    },
    redo: () => {
      if( historyEntry.isMask === true && historyEntry.uninitializeMask ) {
        initializeLayerMask( historyEntry.targetLayer, historyEntry.maskInitializedState );
      }
      historyEntry.affectedContext.putImageData( historyEntry.newData, historyEntry.at.x, historyEntry.at.y );
      if( historyEntry.isMask === true ) flagLayerMaskChanged( historyEntry.targetLayer );
      if( historyEntry.isMask === false ) flagLayerTextureChanged( historyEntry.targetLayer );
    },
  }

  recordHistoryEntry( historyEntry );

  uiSettings.unsavedChanges = true;

}


/* 

After all, I really don't think I should replicate layercode.
I think it's not that expensive to call addCanvasLayer, and I will add a new generic instead of "_temp"
I could replace every reference to "_temp" with "..." hmm.
Okay. Then absolutely no building my own independent layerstack code to maintain.
  We're using paint-preview layers by the gobs to implement selections. They don't even make layerbuttons. 
  Checked, and we only ever reference .layers[0] directly (in export PNG).
  I think we can make these no problem.

What's the first next step?
1. Draw all of the selection stack layers to 1 screen-rect texture with the renderLayers function
2. During the renderLayers loop, include that canvas render result as a layer atop all the rest, with 50% opacity
3. How to test? Add to the selection stack somehow. The selection stack needs layer rects with global coordinates
  a. set up 2 layers with screen-rect coordinates
  b. for each layer, draw onto its canvas an ellipse, one on the left, the other right, so the ellipses overlap
  c. in the screen test, we should see no seam etc.

1. Enable the selection tool via uiSettings
2. Track paint start, and if the selection tool is active, and if the mode is "lasso"
3. call a set of functions that:
  a. preps a screen-sized canvas
  b. starts clearing / redrawing that canvas every frame
    i. redrawing with a looping might cut off formerly filled pixels
  c. uploads the cleared / redrawn result every frame
  d. tracks a list of points (well, this is painter queue)
  e. uses the end-tacked-on canvas-coordinates to plot-fill to that screen-rect canvas
  f. includes that canvas as a 50% opacity layer during the render loop
  g. on finalize:
    i. adds that screen-rect with its global coordinates to the selections stack

Selections explained:

- stack of <image> rects{ topLeft, bottomLeft, topRight, bottomRight }
- we can render that stack onscreen in various ways
- paint function that takes painter's queue of points and does stuff
- for any given paintlayer, we can acquire a pixel buffer representing its selection mask
- clone operation (CPU for now):
  - render batched layers like a group (existing code)
  - render selections stack like a group (existing code)
  - have canvas sized to batched layers, blit batched layers data onto it
  - set canvas op to clip
  - get xy for selections stack group (scale and rotation are unchanging)
  - draw selections stack group onto canvas
  - create new paintlayer populated from that canvas
- cut operation (CPU for now):
  - do clone operation
  - for each batched layer:
    - get selection mask in rect as canvas / image
    - set canvas op to erase
    - draw selection mask
    - flag for texture upload

I need to delete / restart the code below. Some of it makes sense though.
  I understand what it's doing, it was just a very flawed approach. I wasn't thinking at the time.

- we have lasso input: vector fill a line stroked within a single, screen-sized rect
- when creating a new selection, simply erase the selections stack and replace with lasso input
- when modifying existing selection

*/

const lassoResources = {
  lassoPreview: null, //this is the full-screen layer alphas-render of the current lasso stack
  lassoShaderPreview: null, //this is the full-screen fancy shader render of lassoPreview
  lassoActive: null, //this is a redrawn-every-frame canvas2d target layer for lassoing a selection
  renderedLayers: new Map(), //this is a collection of stack-renders within the box of a specific layer
    //renderedLayers.get( keyLayer ) -> render-target layer aligned/sized with keyLayer, containing render of stack
    //these are re-used unless our lasso stack changes or the keylayer is transformed
  lassoStack: [], //this is the stack of real / active lasso areas
  lassoLayers: [], //these are recycleable layers
  currentStackId: 0,
  ready: false,
  invert: false,
}

//this function resets everything about the lasso stack (it's the normal "clear selection" feature)
function clearLassoStack() {
  console.error( "Need to add cancel lasso undo!" );
  const layers = new Set( [
    ...lassoResources.lassoStack,
    ...lassoResources.renderedLayers.values(),
    ...lassoResources.lassoLayers
  ] );
  lassoResources.lassoLayers.length = 0;
  lassoResources.lassoLayers.push( ...layers );
  lassoResources.lassoStack.length = 0;
  lassoResources.renderedLayers.clear();
}

//this function resents any lasso layers for keylayers we've pre-rendered
//it's used when our lasso are has changed, and we need to re-render any layer's specific lasso area
function invalidateLassoLayersForLayers() {
  const layers = new Set( [
    ...lassoResources.renderedLayers.values(),
    ...lassoResources.lassoLayers
  ] );
  lassoResources.lassoLayers.length = 0;
  lassoResources.lassoLayers.push( ...layers );
  lassoResources.renderedLayers.clear();
}
//resizelayertoscreen is a general function. use anywhere as needed
function resizeLayerToScreen( layer ) {
  const screenRect = getScreenPointRect();
  layer.topLeft = [ ...screenRect.topLeft ];
  layer.topRight = [ ...screenRect.topRight ];
  layer.bottomLeft = [ ...screenRect.bottomLeft ];
  layer.bottomRight = [ ...screenRect.bottomRight ];
  layer.w = layer.canvas.width = screenRect.w;
  layer.h = layer.canvas.height = screenRect.h;
  const level = 0;
  const internalFormat = gl.RGBA;
  const layerWidth = layer.w;
  const layerHeight = layer.h;
  const border = 0;
  const format = gl.RGBA;
  const type = gl.UNSIGNED_BYTE;
  const data = null;
  gl.bindTexture( gl.TEXTURE_2D, layer.glTexture );
  gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, layerWidth, layerHeight, border, format, type, data);
}

function renderLassoLayerForLayer( lassoLayer, layer, asImageData = false ) {
  lassoLayer.topLeft = [ ...layer.topLeft ];
  lassoLayer.topRight = [ ...layer.topRight ];
  lassoLayer.bottomLeft = [ ...layer.bottomLeft ];
  lassoLayer.bottomRight = [ ...layer.bottomRight ];
  lassoLayer.w = lassoLayer.canvas.width = layer.w; //I never actually use the canvas though... only the glTexture and imageData
  lassoLayer.h = lassoLayer.canvas.height = layer.h;
  let imageData = null;
  if( asImageData === true ) imageData = lassoLayer.context.createImageData( lassoLayer.w, lassoLayer.h );
  renderLayersAlphasIntoPointRect( lassoLayer, lassoResources.lassoStack, lassoLayer, false, [255,255,255], imageData?.data );
  lassoLayer.lassoImageData = imageData; //imageData | null
}

function getLassoLayerForLayer( layer, asImageData = false ) {
  if( lassoResources.lassoStack.length === 0 ) return null;
  if( lassoResources.renderedLayers.has( layer ) ) {
    const lassoLayer = lassoResources.renderedLayers.get( layer );
    //check for transform
    let transformed = false;
    for( const d of [ "w", "h" ] )
      if( layer[ d ] !== lassoLayer[ d ] ) {
        transformed = true;
        break;
      }
    for( const p of [ "topLeft", "topRight", "bottomLeft", "bottomRight" ] )
      for( let i=0; i<3; i++ ) 
        if( layer[ p ][ i ] !== lassoLayer[ p ][ i ] ) {
          transformed = true;
          break;
        }
    if( transformed || ( asImageData === true && ! lassoLayer.lassoImageData ) ) {
      renderLassoLayerForLayer( lassoLayer, layer, asImageData );
    }
    lassoLayer.invert = lassoResources.invert;
    return lassoLayer;
  }
  const lassoLayer = getNewLassoLayer( layer.w, layer.h );
  renderLassoLayerForLayer( lassoLayer, layer, asImageData );
  lassoResources.renderedLayers.set( layer, lassoLayer );
  lassoLayer.invert = lassoResources.invert;
  return lassoLayer;
}

function getNewLassoLayer( w = null, h = null ) {
  if( lassoResources.lassoLayers.length === 0 ) {
    if( w === null || h === null ) {
      w = gnv.width; h = gnv.height;
    }
    lassoResources.lassoLayers.push( addCanvasLayer( "_temp", w, h ) );
  }
  return lassoResources.lassoLayers.pop();
}
function setupLassoStack() {
  
  lassoResources.lassoPreview = addCanvasLayer( "_temp" );
  //lassoResources.lassoPreview.opacity = 0.5;
  resizeLayerToScreen( lassoResources.lassoPreview );

  lassoResources.lassoShaderPreview = addCanvasLayer( "_temp" );
  //lassoResources.lassoPreview.opacity = 0.5;
  resizeLayerToScreen( lassoResources.lassoShaderPreview );

  lassoResources.ready = true;

}

//Now we should be showing an updated preview.
function updateLassoPreview() {
  if( lassoResources.lassoStack.length === 0 && lassoResources.lassoActive === null )
    return null;

  //this renders the stack alphas into one layer as an alpha channel
  if( lassoResources.previewUpToDate === true ) {
    const screenPoints = getScreenPointRect();
    const { lassoPreview } = lassoResources;
    for( const pointName of [ "topLeft", "topRight", "bottomLeft", "bottomRight" ] ) {
      for( const n of [0,1,2] ) {
        if( lassoPreview[pointName][n] !== screenPoints[pointName][n] ) {
          lassoResources.previewUpToDate = false;
          break;
        }
      }
    }
  }
  if( lassoResources.previewUpToDate === false ) {
    resizeLayerToScreen( lassoResources.lassoPreview );
    resizeLayerToScreen( lassoResources.lassoShaderPreview );
    const layersToRender = [ ...lassoResources.lassoStack ];
    if( lassoResources.lassoActive ) layersToRender.push( lassoResources.lassoActive );
    renderLayersAlphasIntoPointRect( lassoResources.lassoPreview, layersToRender, lassoResources.lassoPreview, false, [255,255,255] );
    lassoResources.previewUpToDate = true;
  }

  //render our preview with a fancy shader
  const floatTime = ( performance.now() % 50000 ) / 50000;
  renderLassoPreviewIntoPointRect( lassoResources.lassoShaderPreview, [ lassoResources.lassoPreview ], floatTime, lassoResources.lassoShaderPreview, false, lassoResources.invert );
  return lassoResources.lassoShaderPreview;
}

//Okay, these functions are all done.
function beginLasso() {
  //1. add a new layer to the lassoStack (so we're drawing it right away), sized to the screen
  //2. track that layer in a variable on resources{}
  lassoResources.lassoActive = getNewLassoLayer();
  resizeLayerToScreen( lassoResources.lassoActive );
  //hmm. I don't think we need to clear keylayer map until finalize
}
function updateLasso( points ) {
  //get the current lasso canvas from where it's stored in a variable on resources{}
  const { lassoActive } = lassoResources;
  //clear lasso canvas
  const { context, w, h } = lassoActive;
  context.clearRect( 0,0,w,h );
  //redraw lasso canvas fill from points
  context.fillStyle = "white";
  context.beginPath();

  if( uiSettings.toolsSettings.lasso.shape === "free" ) {
    let start = true;
    for( const p of points ) {
      //the last entries in points are the screen xy
      const x = p[6], y = p[7];
      if( start === true ) {
        start = false;
        context.moveTo( x,y );
      }
      context.lineTo(x,y);
    }
  }
  else if( uiSettings.toolsSettings.lasso.shape === "rect" ) {
    const a = points[0], b = points[ points.length - 1 ];
    const w = Math.abs( b[0] - a[0] ),
      x = Math.min( a[0], b[0] ),
      h = Math.abs( b[1] - a[1] ),
      y = Math.min( a[1], b[1] );
    context.rect( x, y, w, h );
  }
  else if( uiSettings.toolsSettings.lasso.shape === "ellipse" ) {
    const a = points[0], b = points[ points.length - 1 ];
    const w = Math.abs( b[0] - a[0] ),
      x0 = Math.min( a[0], b[0] ),
      h = Math.abs( b[1] - a[1] ),
      y0 = Math.min( a[1], b[1] ),
      x = x0 + w/2,
      y = y0 + h/2,
      radiusX = w/2,
      radiusY = h/2;
    context.ellipse( x, y, radiusX, radiusY, 0, 0, 6.284, false );
  }

  context.fill();
  //re-upload lasso canvas to its texture
  gl.bindTexture( gl.TEXTURE_2D, lassoActive.glTexture );
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, lassoActive.canvas );
  lassoResources.previewUpToDate = false;
}
function finalizeLasso() {
  console.error( "Need to add finalize lasso undo!" );
  //hmm.
  //just clear the tracking variable in resources, right?
  //move the active lasso to the stack
  lassoResources.lassoStack.push( lassoResources.lassoActive );
  lassoResources.lassoActive = null;
  invalidateLassoLayersForLayers();
}

const viewMatrices = {
    current: [
        1 , 0 , 0 ,
        0 , 1 , 0 ,
        0 , 0 , 1 ,
    ],
    moving: [
        1 , 0 , 0 ,
        0 , 1 , 0 ,
        0 , 0 , 1 ,
    ],
};
const layerTransformMatrices = {
  current: [
      1 , 0 , 0 ,
      0 , 1 , 0 ,
      0 , 0 , 1 ,
  ],
  moving: [
      1 , 0 , 0 ,
      0 , 1 , 0 ,
      0 , 0 , 1 ,
  ],
}

const _final = [
    1 , 0 , 0 ,
    0 , 1 , 0 ,
    0 , 0 , 0
];
const _originMatrix = [
    1 , 0 , -view.origin.x ,
    0 , 1 , -view.origin.y ,
    0 , 0 , 1
];
const _positionMatrix = [
    1 , 0 , view.origin.x ,
    0 , 1 , view.origin.y ,
    0 , 0 , 1
];
function finalizeViewMove() {
    mul3x3( viewMatrices.current , _originMatrix , _final ); // origin * current
    mul3x3( _final , viewMatrices.moving , _final ); // (origin*current) * moving
    mul3x3( _final , _positionMatrix , viewMatrices.current ); //current = ( (origin*current) * moving ) * position

    id3x3( viewMatrices.moving ); //zero-out moving for next transformation
    
    view.origin.x = 0;
    view.origin.y = 0;
    view.pan.x = 0;
    view.pan.y = 0;
    view.zoom = 1;
    view.angle = 0;
    view.initialAngleOffset = 0;
    view.initialZoomLength = 0;

    //renable transform for next pinch if it was temporarily disable for nav
    if( uiSettings.activeTool === "transform" )
      uiSettings.toolsSettings.transform.current = true;

}
function finalizeLayerTransform() {

  const layersToTransform = [ ...uiSettings.toolsSettings.transform.transformingLayers ];
  const transformRecords = [];

  getTransform();
  //get our global space coordinates inverter
  _originMatrix[ 2 ] = -view.origin.x;
  _originMatrix[ 5 ] = -view.origin.y;
  _positionMatrix[ 2 ] = view.origin.x;
  _positionMatrix[ 5 ] = view.origin.y;

  mul3x3( viewMatrices.current , _originMatrix , _inverter );
  mul3x3( _inverter , viewMatrices.moving , _inverter );
  mul3x3( _inverter , _positionMatrix , _inverter );
  //get inverse view
  inv( _inverter , _inverter );

  getLayerTransform();

  for( const layerToTransform of layersToTransform ) {
    const transformRecord = {
      oldData: null,
      newData: null,
      targetLayer: null,
    }
  
    const oldData = {
      scale: layerToTransform.transform.scale,
      angle: layerToTransform.transform.angle,
    }
    for( const pointName of [ "topLeft", "topRight", "bottomLeft", "bottomRight" ] ) {
      oldData[ pointName ] = [ ...layerToTransform[ pointName ] ];
    }
  
    //apply the layer transform to the layer
    layerToTransform.transform.scale *= layerTransform.zoom;
    layerToTransform.transform.angle += layerTransform.angle;
  
    //convert our on-screen transform coordinates to global space coordinates
    for( const pointName of [ "topLeft", "topRight", "bottomLeft", "bottomRight" ] ) {
      const transformingPoint = layerToTransform.transform.transformingPoints[ pointName ];
      //apply inverse view
      mul3x1( _inverter, transformingPoint, transformingPoint );
      //store updated points
      //at some point, I need to rectify these. Make sure the legs are at right angles and the aspect ratio is fixed etc.
      layerToTransform[ pointName ][ 0 ] = transformingPoint[ 0 ];
      layerToTransform[ pointName ][ 1 ] = transformingPoint[ 1 ];
      layerToTransform[ pointName ][ 2 ] = 1;
    }
  
    const newData = {
      scale: layerToTransform.transform.scale,
      angle: layerToTransform.transform.angle,
    }
    for( const pointName of [ "topLeft", "topRight", "bottomLeft", "bottomRight" ] ) {
      newData[ pointName ] = [ ...layerToTransform[ pointName ] ];
    }

    flagLayerGroupChanged( layerToTransform );

    transformRecord.oldData = oldData;
    transformRecord.newData = newData;
    transformRecord.targetLayer = layerToTransform;

    transformRecords.push( transformRecord );

  }

  id3x3( layerTransformMatrices.current ); //zero-out current for next transformation, since we're applying the transform to the points
  id3x3( layerTransformMatrices.moving ); //zero-out moving for next transformation
  
  layerTransform.origin.x = 0;
  layerTransform.origin.y = 0;
  layerTransform.pan.x = 0;
  layerTransform.pan.y = 0;
  layerTransform.zoom = 1;
  layerTransform.angle = 0;
  layerTransform.initialAngleOffset = 0;
  layerTransform.initialZoomLength = 0;

  getLayerTransform(); //reset matrices pipeline

  if( selectedLayer?.layerType === "group" )
    updateLayerGroupCoordinates( selectedLayer );
  
  const historyEntry = {
    transformRecords,
    undo: () => {
      for( const {targetLayer,oldData} of historyEntry.transformRecords ) {
        //reinstall old data
        targetLayer.transform.scale = oldData.scale;
        targetLayer.transform.angle = oldData.angle;
        for( const pointName of [ "topLeft", "topRight", "bottomLeft", "bottomRight" ] ) {
          targetLayer[ pointName ] = [ ...oldData[ pointName ] ]
        }
        flagLayerGroupChanged( targetLayer );    
      }
    },
    redo: () => {
      for( const {targetLayer,newData} of historyEntry.transformRecords ) {
        //reinstall new data
        targetLayer.transform.scale = newData.scale;
        targetLayer.transform.angle = newData.angle;
        for( const pointName of [ "topLeft", "topRight", "bottomLeft", "bottomRight" ] ) {
          targetLayer[ pointName ] = [ ...newData[ pointName ] ]
        }
        flagLayerGroupChanged( targetLayer );    
      }
    },
  };
  recordHistoryEntry( historyEntry );
  
  UI.updateView();

  uiSettings.unsavedChanges = true;

}

const _rot = [
        1 , 0 , 0 ,
        0 , 1 , 0 ,
        0 , 0 , 1
    ];
const _scale = [
        1 , 0 , 0 ,
        0 , 1 , 0 ,
        0 , 0 , 1
    ];
function mat( zoom , angle , dx , dy  ,  destination ) {
    _rot[ 0 ] = Math.cos( angle ); _rot[ 1 ] = -Math.sin( angle ); _rot[ 2 ] = dx;
    _rot[ 3 ] = Math.sin( angle ); _rot[ 4 ] = Math.cos( angle ); _rot[ 5 ] = dy;

    _scale[ 0 ] = zoom;
    _scale[ 4 ] = zoom;

    mul3x3( _rot , _scale , destination );
}

let _temp3x3 = [
    0 , 0 , 0 ,
    0 , 0 , 0 ,
    0 , 0 , 0
];
function mul3x3( a , b , destination ) {
    _temp3x3[ 0 ] = b[0]*a[0]+b[1]*a[3]+b[2]*a[6]; _temp3x3[ 1 ] = b[0]*a[1]+b[1]*a[4]+b[2]*a[7]; _temp3x3[ 2 ] = b[0]*a[2]+b[1]*a[5]+b[2]*a[8];
    _temp3x3[ 3 ] = b[3]*a[0]+b[4]*a[3]+b[5]*a[6]; _temp3x3[ 4 ] = b[3]*a[1]+b[4]*a[4]+b[5]*a[7]; _temp3x3[ 5 ] = b[3]*a[2]+b[4]*a[5]+b[5]*a[8];
    _temp3x3[ 6 ] = b[6]*a[0]+b[7]*a[3]+b[8]*a[6]; _temp3x3[ 7 ] = b[6]*a[1]+b[7]*a[4]+b[8]*a[7]; _temp3x3[ 8 ] = b[6]*a[2]+b[7]*a[5]+b[8]*a[8];

    for( let i=0; i<9; i++ ) destination[ i ] = _temp3x3[ i ];
}

let _temp3x1 = [ 0 , 0 , 0 ];
function mul3x1( mat , vec , destination ) {
    _temp3x1[ 0 ] = vec[0]*mat[0]+vec[1]*mat[1]+vec[2]*mat[2];
    _temp3x1[ 1 ] = vec[0]*mat[3]+vec[1]*mat[4]+vec[2]*mat[5];
    _temp3x1[ 2 ] = vec[0]*mat[6]+vec[1]*mat[7]+vec[2]*mat[8];
    for( let i=0; i<3; i++ ) destination[ i ] = _temp3x1[ i ];
}

function set3x3( a , destination ) {
    for( let i=0; i<9; i++ ) destination[ i ] = a[ i ];
}

function id3x3( destination ) {
    destination[ 0 ] = 1; destination[ 1 ] = 0; destination[ 2 ] = 0;
    destination[ 3 ] = 0; destination[ 4 ] = 1; destination[ 5 ] = 0;
    destination[ 9 ] = 0; destination[ 7 ] = 0; destination[ 8 ] = 1;
}


const _minv_ref = [
        1 , 0 , 0 , //row 0 (first)
        0 , 1 , 0 , //row 3 (second)
        0 , 0 , 1   //row 6 (third)
    ];
const _minv_res = [
        1 , 0 , 0 , //row 0 (first)
        0 , 1 , 0 , //row 3 (second)
        0 , 0 , 1   //row 6 (third)
    ];

//swap positions of row a and row b, where ia and ib belong to the set (0,3,6).
function inv_swapRow( ia , ib ) {
    let a;
    a = _minv_ref[ ia + 0 ]; _minv_ref[ ia + 0 ] = _minv_ref[ ib + 0 ]; _minv_ref[ ib + 0 ] = a;
    a = _minv_ref[ ia + 1 ]; _minv_ref[ ia + 1 ] = _minv_ref[ ib + 1 ]; _minv_ref[ ib + 1 ] = a;
    a = _minv_ref[ ia + 2 ]; _minv_ref[ ia + 2 ] = _minv_ref[ ib + 2 ]; _minv_ref[ ib + 2 ] = a;

    a = _minv_res[ ia + 0 ]; _minv_res[ ia + 0 ] = _minv_res[ ib + 0 ]; _minv_res[ ib + 0 ] = a;
    a = _minv_res[ ia + 1 ]; _minv_res[ ia + 1 ] = _minv_res[ ib + 1 ]; _minv_res[ ib + 1 ] = a;
    a = _minv_res[ ia + 2 ]; _minv_res[ ia + 2 ] = _minv_res[ ib + 2 ]; _minv_res[ ib + 2 ] = a;
}
//scale row i by factor s, where i belongs to the set (0,3,6)
function inv_scaleRow( i , s ) {
    _minv_ref[ i + 0 ] *= s; _minv_ref[ i + 1 ] *= s; _minv_ref[ i + 2 ] *= s;
    _minv_res[ i + 0 ] *= s; _minv_res[ i + 1 ] *= s; _minv_res[ i + 2 ] *= s;
}
/* 
    Interfere row: subtract a scaled version of the source row from the interefered row.
    That scale is derived from whatever entry of the interfered row lies on the same
    column as the diagonal that intersects the source row. (Yeah, it's a bit much.)
    where is and id belong to the set (0,3,6)
 */
function inv_interfereRow( is /* index source */ , id /* index interfere row */, F ) {
    _minv_ref[ id + 0 ] -= F * _minv_ref[ is + 0 ]; _minv_ref[ id + 1 ] -= F * _minv_ref[ is + 1 ]; _minv_ref[ id + 2 ] -= F * _minv_ref[ is + 2 ];
    _minv_res[ id + 0 ] -= F * _minv_res[ is + 0 ]; _minv_res[ id + 1 ] -= F * _minv_res[ is + 1 ]; _minv_res[ id + 2 ] -= F * _minv_res[ is + 2 ];
}

/* Compute the inverse of matrix m and store the result in matrix destination. */
function inv( m , destination ) {
    //copy m -> _minv_ref
    for( let i=0; i<9; i++ ) _minv_ref[ i ] = m[ i ];
    //reset result matrix _minv_res to identity
    _minv_res[ 0 ] = 1; _minv_res[ 1 ] = 0; _minv_res[ 2 ] = 0;
    _minv_res[ 3 ] = 0; _minv_res[ 4 ] = 1; _minv_res[ 5 ] = 0;
    _minv_res[ 6 ] = 0; _minv_res[ 7 ] = 0; _minv_res[ 8 ] = 1;

    /* ------------------- Row 0 ------------------- */
    //swap rows to get non-zero diagonals
    if( _minv_ref[ 0 ] === 0 ) {
        if( _minv_ref[ 3 ] !== 0 ) inv_swapRow( 0 , 3 );
        else if( _minv_ref[ 6 ] !== 0 ) inv_swapRow( 0 , 6 );
        else throw `Uninvertible Matrix Error`;
    }
    //Normalize row by diagonal
    const row0Diagonal = _minv_ref[ 0 ];
    inv_scaleRow( 0 , 1/row0Diagonal );
    //Interfere rows 3 and 6
    inv_interfereRow( 0 , 3 , _minv_ref[ 3 ] );
    inv_interfereRow( 0 , 6 , _minv_ref[ 6 ] );
    /* --------------------------------------------- */

    
    /* ------------------- Row 3 ------------------- */
    //swap rows to get non-zero diagonals
    if( _minv_ref[ 4 ] === 0 ) {
        if( _minv_ref[ 1 ] !== 0 ) inv_swapRow( 3 , 0 );
        else if( _minv_ref[ 7 ] !== 0 ) inv_swapRow( 3 , 6 );
        else throw `Uninvertible Matrix Error`;
    }
    //Normalize row by diagonal
    const row3Diagonal = _minv_ref[ 4 ];
    inv_scaleRow( 3 , 1/row3Diagonal );
    //Interfere rows 0 and 6
    inv_interfereRow( 3 , 0 , _minv_ref[ 1 ] );
    inv_interfereRow( 3 , 6 , _minv_ref[ 7 ] );
    /* --------------------------------------------- */

    
    /* ------------------- Row 6 ------------------- */
    //swap rows to get non-zero diagonals
    if( _minv_ref[ 8 ] === 0 ) {
        if( _minv_ref[ 2 ] !== 0 ) inv_swapRow( 6 , 0 );
        else if( _minv_ref[ 5 ] !== 0 ) inv_swapRow( 6 , 3 );
        else throw `Uninvertible Matrix Error`;
    }
    //Normalize row by diagonal
    const row6Diagonal = _minv_ref[ 8 ];
    inv_scaleRow( 6 , 1 / row6Diagonal );
    //Interfere rows 0 and 3
    //Note: There is no need to scale the reference at this last step
    inv_interfereRow( 6 , 0 , _minv_ref[ 2 ] );
    inv_interfereRow( 6 , 3 , _minv_ref[ 5 ] );
    /* --------------------------------------------- */

    //copy result _minv_res into destination
    for( let i=0; i<9; i++ ) destination[ i ] = _minv_res[ i ];
}

function hslToRgb(h, s, l) {
  const rgb = [1/3,0,-1/3];

  if (s === 0) {
      rgb[0] = rgb[1] = rgb[2] = Math.round( 255 * l );
  } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      for( const i in rgb ) {
        let t = h + rgb[i];
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) rgb[i] = Math.round( 255 * (p + (q - p) * 6 * t) );
        else if (t < 1/2) rgb[i] = Math.round( 255 * q );
        else if (t < 2/3) rgb[i] = Math.round( 255 * (p + (q - p) * (2/3 - t) * 6) );
        else rgb[i] = Math.round( 255 * p );
      }
  }

  return rgb;
}

function rgbToHsl(r, g, b) {
  (r /= 255), (g /= 255), (b /= 255);
  const vmax = Math.max(r, g, b), vmin = Math.min(r, g, b);
  let h, s, l = (vmax + vmin) / 2;

  if (vmax === vmin) {
    return [0, 0, l]; // achromatic
  }

  const d = vmax - vmin;
  s = l > 0.5 ? d / (2 - vmax - vmin) : d / (vmax + vmin);
  if (vmax === r) h = (g - b) / d + (g < b ? 6 : 0);
  if (vmax === g) h = (b - r) / d + 2;
  if (vmax === b) h = (r - g) / d + 4;
  h /= 6;

  return [h, s, l];
}

const wait = delay => new Promise( land => setTimeout( land, delay ) );

const apiExecutionQueue = [];

const verboseAPICall = false;
async function executeAPICall( name, controlValues ) {

  if( verboseAPICall ) console.log( "Executing API call: ", name );

  const selfQueue = [name, controlValues];
  apiExecutionQueue.push( selfQueue );

  while( apiExecutionQueue[ 0 ] !== selfQueue ) {
    await wait( uiSettings.retryAPIDelay );
  }

  const apiFlow = apiFlows.find( flow => flow.apiFlowName === name );
  //for each control, set its value from the values
  //execute each apiCall in order
  const apiResults = {};
  let retryCount = 0;
  for( let i=0; i<apiFlow.apiCalls.length; i ) {

    const apiCall = apiFlow.apiCalls[ i ];

    if( verboseAPICall ) console.log( "On apicall ", apiCall.apiCallName )

    let resultSchemeExpectingRawFile = false;
    for( const resultScheme of apiCall.results ) {
      if( resultScheme.resultPath === "file" ) {
        resultSchemeExpectingRawFile = resultScheme;
        break;
      }
    }

    //process it and get results
    const results = {};
    const completionStatus = await new Promise( async complete => {
      const xhr = new XMLHttpRequest();
      xhr.onload = async () => {
        if( resultSchemeExpectingRawFile ) {
          if( resultSchemeExpectingRawFile.resultType === "file-image" ) {
            const reader = new FileReader();
            reader.onload = () => {
              if( verboseAPICall ) console.log( "Finished reading raw file as dataURL: " + reader.result.substring( 0, 20 ) + "..." );
              const img = new Image();
              img.onload = () => {
                if( verboseAPICall ) console.log( "Finished loading image from dataURL and storing in result ",  resultSchemeExpectingRawFile.resultName );
                results[ resultSchemeExpectingRawFile.resultName ] = img;
                complete( true );
              }
              img.onerror = () => {
                console.error( "Failed to read xhr.response as good data url. Try something else?" );
              };
              img.src = reader.result;
              
            }
            if( verboseAPICall ) console.log( "Going to try reading response as file | type ", xhr.responseType, " | ", typeof xhr.response );
            //Hmm... Isn't it cached now? Can't I just set the URL as my image url? No... Because it's reflected. :-/ Hmm.
            //reader.readAsDataURL( new Blob( [xhr.response], { type: "image/png" } ) );
            reader.readAsDataURL( xhr.response );

          }
        }
        else {
          let jsonResponse = undefined;

          if( (xhr.response === "" || xhr.response === "{}") && apiCall.retryOnEmpty ) {
            if( verboseAPICall ) console.log( "Got empty response. Retrying in ", uiSettings.retryAPIDelay, " ms." );
            await wait( uiSettings.retryAPIDelay );
            complete( "retry" );
            return;
            //Else continue. An API call may not need to return anything, after all.
          }

          try {
            if( verboseAPICall ) console.log( "Parsing response as JSON" );
            jsonResponse = JSON.parse( xhr.response );
          }
          catch ( e ) {
              console.error( "Not JSON. Alert api call failed. Response: ", xhr.response );
              complete( false );
          }
          if( jsonResponse !== undefined ) {
            if( verboseAPICall ) console.log( "Got API JSON response: ", jsonResponse );

            for( const resultScheme of apiCall.results ) {
              if( verboseAPICall ) console.log( "Starting with result ", resultScheme );
              const resultSuccessful = await new Promise( proceed => {
                const path = [ ...resultScheme.resultPath ];
                results[ resultScheme.resultName ] = jsonResponse;
                while( path.length ) {
                  if( typeof results[ resultScheme.resultName ] !== "object" ) {
                    //path cannot be resolved
                    console.error( "Unresolvable result path.", results, resultScheme, jsonResponse, controlValues );
                    proceed( false );
                  }
                  const key = path.shift();
                  results[ resultScheme.resultName ] = results[ resultScheme.resultName ][ key ];
                }
                //got result
                if( resultScheme.resultType === "base64-image" ) {
                  const img = new Image();
                  img.onload = () => {
                    results[ resultScheme.resultName ] = img;
                    proceed( true );
                  }
                  img.src = "data:image/png;base64," + results[ resultScheme.resultName ];
                }
                if( resultScheme.resultType === "file-image" ) {
                  const img = new Image();
                  img.onload = () => {
                    results[ resultScheme.resultName ] = img;
                    proceed( true );
                  }
                  img.src = "data:image/png;base64," + results[ resultScheme.resultName ];
                }
                if( resultScheme.resultType === "dictionary-object-list" ) {
                  results[ resultScheme.resultName ] = Object.entries( results[ resultScheme.resultName ] );
                  proceed( true );
                }
                if( resultScheme.resultType === "array-object" ) {
                  //results[ resultScheme.resultName ] = jsonResponse;
                  proceed( true );
                }
                if( resultScheme.resultType === "array-string" ) {
                  //console.log( "Updated results: ", results );
                  //results[ resultScheme.resultName ] = results[ resultScheme.resultName ][ 0 ]; //THIS IS A BUG! I don't know why I need this line. :-|
                  proceed( true );
                }
                if( resultScheme.resultType === "string" ) {
                  //console.log( "Installed resultscheme string ")
                  //this section of code is just for post-processing. For a simple string, we've already stored the result
                  //results[ resultScheme.resultName ] = response;
                  proceed( true );
                }
              } );
              if( resultSuccessful === false ) {
                console.error( "Unable to retrieve a result." );
                complete( false );
              }
            }
            if( verboseAPICall ) console.log( "Now have accumulated results: ", results );
            //populated all results
            complete( true );
          }
        }
      }
      //load api values from controls
      for( const controlScheme of apiFlow.controls ) {
        if( verboseAPICall ) console.log( "On controlscheme ", controlScheme.controlName );
        if( controlScheme.controlPath[ 0 ] === apiCall.apiCallName || controlScheme.controlPath[ 0 ] === "controlValue" ) {

          let target;

          let [ topLevel, isApiOrConfig, ...controlPath ] = controlScheme.controlPath;

          if( topLevel === apiCall.apiCallName && isApiOrConfig === "api" ) {
            target = apiCall.api;
            while( controlPath.length > 1 )
              target = target[ controlPath.shift() ];
          }
          else if( topLevel === apiCall.apiCallName ) {
            target = apiCall;

            controlPath = [ isApiOrConfig, ...controlPath ];
            for( let i=0, j=controlPath.length-1; i<j; i++ ) {
              target = target[ controlPath.shift() ];
            }
          }
          else if( topLevel === "controlValue" ) {
            target = controlScheme;
            controlPath = [ "controlValue" ]
          }

          //controlpath is down to the last key
          //assign via corresponding name in controlValues object
          if( controlScheme.controlType === "api-result" ) {
            let retrievedResult = apiResults;
            for( let i=0; i<controlScheme.resultPath.length; i++ )
              retrievedResult = retrievedResult?.[ controlScheme.resultPath[ i ] ];
            if( ! retrievedResult ) {
              //nothing to set yet in this call.
              continue;
            }
            if( verboseAPICall ) console.log( "Assigning result ", retrievedResult, " to target ", target[ controlPath[ 0 ] ] );
            target[ controlPath.shift() ] = retrievedResult;
          }
          else if( controlScheme.controlType === "control-value" ) {
            let retrievedValue = apiFlow.controls.find( c => c.controlName === controlScheme.controlValuePath[ 0 ] );
            for( let i=1; i<controlScheme.controlValuePath.length; i++ ) {
              retrievedValue = retrievedValue?.[ controlScheme.controlValuePath[ i ] ];
            }
            if( ! retrievedValue ) {
              //Could be problematic, but moving on. Hopefully the default is usable!
              continue;
            }
            if( verboseAPICall ) console.log( "Assigning control-value ", retrievedValue, " to target ", target[ controlPath[ 0 ] ] );
            target[ controlPath.shift() ] = retrievedValue;
          }
          else if( controlScheme.controlType === "apiFlowVariable" ) {
            const variable = uiSettings.apiFlowVariables.find( v => v.key === controlScheme.variableKey );
            if( variable && variable.permissions.includes( apiFlow.apiFlowName ) ) {
              controlScheme.controlValue = variable.value;
              target[ controlPath.shift() ] = variable.value;
            } else {
              console.error( "Failed to load variable ", variable, " for apiflow ", apiFlow );
              complete( false );
            }
          }
          else if( controlScheme.controlType === "apiPort") {
            controlScheme.controlValue = uiSettings.backendPort;
            target[ controlPath.shift() ] = uiSettings.backendPort;
          }
          else if( controlScheme.controlType === "appPort") {
            controlScheme.controlValue = uiSettings.appPort;
            target[ controlPath.shift() ] = uiSettings.appPort;
          }
          else if( controlScheme.controlType === "string-compose" ) {
            //check if this is an api-result from the current apicall, probably unnecessary given
            let composedString = "";
            for( const composePath of controlScheme.composePaths ) {
              const compositionPath = [ ...composePath ];
              if( typeof composePath === "string" ) composedString += composePath;
              else {
                const controlName = compositionPath.shift();
                if( verboseAPICall ) console.log( "Looking up controlname for composition: ", controlName );
                let lookup = apiFlow.controls.find( c => c.controlName === controlName );
                for( let i=0; i<compositionPath.length; i++ ) 
                  lookup = lookup[ compositionPath[ i ] ]; //incase controlValue is an obj{} IDK
                  if( verboseAPICall ) console.log( "Got loookup ", lookup, " from path ", compositionPath );
                composedString += lookup;
              }
            }
            if( verboseAPICall ) console.log( "Installing composed string ", composedString, " onto target ", target[ controlPath[ 0 ] ] );
            target[ controlPath.shift() ] = composedString;
          }

          else if( controlValues.hasOwnProperty( controlScheme.controlName ) )
            target[ controlPath.shift() ] = controlValues[ controlScheme.controlName ];

          else target[ controlPath.shift() ] = controlScheme.controlValue;

        }
      }
      {
        if( apiCall.method === "POST" ) {
          const postData = {
            method: "POST",
            //url: "http://127.0.0.1:"+ apiCall.port + apiCall.apiPath,
            path: apiCall.apiPath,//path: "/sdapi/v1/txt2img",
            host: apiCall.host,
            port: apiCall.port, //port: '7860',
            dataFormat: apiCall.dataFormat,
            convertDataImages: !!apiCall.convertDataImages,
            protocol: apiCall.protocol,
            apiData: apiCall.api,
            headerData: apiCall.headers
          }
          if( ! apiCall.port ) delete postData.port;
          if( ! apiCall.protocol ) delete postData.protocol;
          xhr.open( "POST", "/api" );
          if( resultSchemeExpectingRawFile ) xhr.responseType = "blob";
          //apiCall.api has been modified from controlValues, and is ready to send
          xhr.send(new Blob([JSON.stringify(postData)],{"Content-Type":"application/json"}));
        }
        if( apiCall.method === "GET" ) {
          const postData = {
            method: "GET",
            //url: "http://127.0.0.1:"+ apiCall.port + apiCall.apiPath,
            path: apiCall.apiPath,//path: "/sdapi/v1/txt2img",
            host: apiCall.host,
            port: apiCall.port, //port: '7860',
            //apiData: apiCall.api
          }
          //This is not a typo. We POST to the backend; it runs a GET and reflects.
          xhr.open( "POST", "/api" );
          if( resultSchemeExpectingRawFile ) xhr.responseType = "blob";
          //apiCall.api has been modified from controlValues, and is ready to send
          xhr.send(new Blob([JSON.stringify(postData)],{"Content-Type":"application/json"}));
        }
      }
    } );
    if( completionStatus === true ) {
      apiResults[ apiCall.apiCallName ] = results;
      if( verboseAPICall ) console.log( "Finished API call successfully with results: ", results );
      ++i;
      retryCount = 0;
    }
    else if( completionStatus === false ) {
      console.error( "Failed to complete apicall." );
      apiExecutionQueue.splice( apiExecutionQueue.indexOf( selfQueue ), 1 );
    
      return false;
    }
    else if( completionStatus === "retry" ) {
      retryCount++;
      //and loop
    }
  }
  const outputs = {};
  //successfully populated apiResults, or else returned error
  for( const outputScheme of apiFlow.outputs ) {
    const apiCallName = outputScheme.outputResultPath[ 0 ];
    const result = apiResults[ apiCallName ][ outputScheme.outputResultPath[ 1 ] ];
    if( outputScheme.outputType === "image" ) {
      outputs[ outputScheme.outputName ] = result;
    }
    if( outputScheme.outputType === "assets" ) {
      if( verboseAPICall ) console.log( "Mapping outputscheme ", outputScheme, " with result ", result );
      const library = assetsLibrary[ outputScheme.outputLibraryName ] ||= [];
      const mappedAssets = [];
      for( const resultEntry of result ) {
        const mappedAsset = {};
        for( const {key,path,optional} of outputScheme.assetMap ) {
          mappedAsset[ key ] = resultEntry;
          for( let i=0; i<path.length; i++ )
            mappedAsset[ key ] = mappedAsset[ key ]?.[ path[ i ] ];
          if( optional === true && mappedAsset[ key ] === undefined )
            delete mappedAsset[ key ];
        }
        library.push( mappedAsset );
        mappedAssets.push( mappedAsset );
      }
      outputs[ outputScheme.outputName ] = mappedAssets;
    }
  }
  if( verboseAPICall ) console.log( "Finished apiFlow with outputs: ", outputs );

  apiExecutionQueue.splice( apiExecutionQueue.indexOf( selfQueue ), 1 );

  return outputs;
}

const assetInterpreters = {
  clearPreview: () => {
    const assetBrowserPreview = document.querySelector( "#asset-browser-preview" );
    assetBrowserPreview.innerHTML = "";
  },
  "simple-name": {
    makeElement: asset => {
      const assetElement = document.createElement( "div" );
      assetElement.textContent = asset.name;
      assetElement.classList.add( "asset-element" );
      return assetElement;
    },
    showPreview: asset => {
      const assetBrowserPreview = document.querySelector( "#asset-browser-preview" );
      assetBrowserPreview.textContent = asset.name;
    },
  },
  "APIFlows": {
    makeElement: asset => {
      const assetElement = document.createElement( "div" );
      assetElement.textContent = asset.apiFlowName;
      assetElement.classList.add( "asset-element" );
      return assetElement;
    },
    showPreview: asset => {
      const assetBrowserPreview = document.querySelector( "#asset-browser-preview" );
      assetBrowserPreview.textContent = asset.apiFlowName;
    },
    defaultSort: (a,b) => ( a.apiFlowName > b.apiFlowName ) ? 1 : (( a.apiFlowName === b.apiFlowName ) ? 0 : -1),
  }
}

const assetsLibrary = {}

//a 3w*2h image with random colors and a solid alpha channel
const testImageURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAI0lEQVQIW2P86qL8/+hjPoazEzYzME5ljf5/WzOWQf6GJgMAnNkKmdnTKGIAAAAASUVORK5CYII=";

async function loadDefaultAPIFlows() {
  const flowsResponse = await fetch( "/apiFlows" );
  const apiFlowNames = await flowsResponse.json();
  apiFlowNames.sort( (a,b) => a>b );
  const apiLoadPromises = [];
  for( const defaultAPIFlowName of apiFlowNames ) {
    apiLoadPromises.push( 
      fetch( "apiFlows/" + defaultAPIFlowName ).then(
        async response => {
          if( response.ok ) {
            const apiFlow = await response.json();
            const existingApiFlow = apiFlows.find( f => f.apiFlowName === apiFlow.apiFlowName );
            if( existingApiFlow ) {
              UI.showOverlay.error( "Some APIFlows failed to load because of duplicate names." );
              console.error( "Failed to load duplicate apiflow name: ", apiFlow.apiFlowName );
            }
            else apiFlows.push( apiFlow );
            //console.log( "Loaded apiflow ", defaultAPIFlowName );
          } else {
            console.error( "Failed to load default apiflow: ", defaultAPIFlowName );
          }
        }
      )
    );
  }
  return Promise.all( apiLoadPromises );
}

let apiFlowsLoadAwaiter = loadDefaultAPIFlows();
apiFlowsLoadAwaiter.then( () => apiFlows.sort( (a,b) => a.apiFlowName > b.apiFlowName ) )

const apiFlows = []

setup();