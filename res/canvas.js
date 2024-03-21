
/* Working Proof of Concept:

    What next?
    Iterate! Don't optimize!
    

    UI:
    - layer drag+drop groups (for visible->img2img)
    - gen history
    - comfy
    - asset browser for some hard-coded brush configs, gen presets, models, loras, *?
      : brushes pencil and brushpen
    - air undo / redo
    - air brush size/opacity/softness
    - flood fill
    - text
    Misc:
    - air wheel
    - flood fill
    - text

    
    Painting -> GPU (think about it, but not until the UI work is real)

*/
const VERSION = 3;

const main = document.createElement( "div" ),
  uiContainer = document.createElement( "div" ),
  overlayContainer = document.createElement( "div" );
main.id = "main";
uiContainer.id = "ui";
overlayContainer.id = "overlay";

/* const cnv = document.createElement( "canvas" ),
  ctx = cnv.getContext( "2d" );
cnv.id = "cnv"; */

const gnv = document.createElement( "canvas" ),
gl = gnv.getContext( "webgl2", {premultipliedAlpha: false, alpha: false} );
gnv.id = "gnv";

let W = 0, H = 0;
let currentImage = null,
  //currentArtCanvas = null,
  selectedLayer = null,
  selectedPaintLayer = null,
  selectedGenLayer = null;

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

let layersAddedCount = -2;
async function addCanvasLayer( layerType, layerWidth=null, layerHeight=null, nextSibling=null, doNotUpdate=false ) {
  
  //layerType === "paint" | "paint-preview" | "generative" | "group" | "text" | "pose" | "model" | ...

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

  //create the back-end layer info
  console.error( "On gen layer make, pull current / last used / first api flow controls" );

  const newLayer = {
    //layerOrder: layersStack.layers.length, //not implemented
    layerType,
    layerName: "Layer " + (++layersAddedCount),
    layerId: layersAddedCount,
    layerGroupId: null,
    groupCompositeUpToDate: false,
    groupClosed: false,

    visible: true,
    setVisibility: null,
    opacity:1.0,
    setOpacity: null,

    //changes IFF you change it
    generativeSettings: { apiFlowName },
    nodeUplinks: new Set(),
    generativeControls: {},

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
        srcFormat = gl.RGBA,
        srcType = gl.UNSIGNED_BYTE;
      gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, newLayer.maskCanvas );
    }
  }

  let layerButton;
  if( layerType !== "paint-preview" ) {
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
          if( !currentlyScrolling && ending === true && dt < 200 && Math.abs(dy) < 5 ) {
            if( newLayer !== selectedLayer ) {
              selectLayer( newLayer );
            }
            else if( newLayer === selectedLayer && newLayer.layerType === "group" ) {
              newLayer.groupClosed = ! newLayer.groupClosed;
              reorganizeLayerButtons();
            }
          }
          if( !currentlyScrolling && ( Math.abs( dy ) > 5 || dt > 200 ) ) {
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

    //add the layer type icon
    {
      const groupIcon = document.createElement( "div" );
      groupIcon.classList.add( "layer-type-icon", newLayer.layerType );
      if( newLayer.layerType === "group" ) {
        groupIcon.classList.add( "open" );
      }
      layerButton.appendChild( groupIcon );
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
      layerButton.appendChild( opacitySlider );
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
      layerButton.appendChild( visibilityButton );
    }
    
    //the duplicate button
    {
      const duplicateButton = document.createElement( "div" );
      duplicateButton.classList.add( "layer-duplicate-button", "layer-ui-button", "animated" );
      UI.registerElement(
        duplicateButton,
        {
          onclick: async () => {

            //Hooo boy. I can already feel the RAM hurting.
            if( newLayer.layerType === "group" ) {
              const groupedLayers = [ newLayer ];
              for( let i = layersStack.layers.indexOf( newLayer )-1; i>=0; i-- ) {
                const layer = layersStack.layers[ i ];
                if( ! getLayerGroupChain( layer ).includes( newLayer.layerId ) ) break;
                groupedLayers.push( layer );
              }

              const copyMap = [], 
                historyEntries = [];

              //we're going to catch our historyEntries
              for( const layer of groupedLayers ) {
                //adding all copies as siblings directly above the current layer, one by one
                const copy = await addCanvasLayer( layer.layerType, layer.w, layer.h, newLayer, true );
                //by altering the properties without registering a new undo, the creation undo is a copy
                copy.layerName = layer.layerName;
                if( layer === newLayer ) copy.layerGroupId = newLayer.layerGroupId;
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
                //steal the undo entry
                const historyEntry = history.pop();
                historyEntries.push( historyEntry );
              }
              //match up the layergroup structures
              for( let i=0; i<copyMap.length; i++ ) {
                const originalParentMap = copyMap.find( ({layer}) => layer.layerId === copyMap[ i ].layer.layerGroupId );
                //top-level layer has no parent
                if( ! originalParentMap ) continue;
                copyMap[ i ].copy.layerGroupId = originalParentMap.copy.layerId;
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
            }
            else {
              //adding the new layer inherently adds the undo component
              const copy = await addCanvasLayer( newLayer.layerType, newLayer.w, newLayer.h, newLayer, true )
              //by altering the properties without registering a new undo, the creation undo is a copy
              copy.layerName = newLayer.layerName;
              copy.layerGroupId = newLayer.layerGroupId;
              copy.context.drawImage( newLayer.canvas, 0, 0 );
              if( newLayer.maskInitialized )
                copy.maskContext.drawImage( newLayer.maskCanvas, 0, 0 );
              copy.textureChanged = true;
              copy.setVisibility( newLayer.visible );
              copy.setOpacity( newLayer.opacity );
              copy.topLeft = [ ...newLayer.topLeft ];
              copy.topRight = [ ...newLayer.topRight ];
              copy.bottomLeft = [ ...newLayer.bottomLeft ];
              copy.bottomRight = [ ...newLayer.bottomRight ];
            }
            reorganizeLayerButtons();
            UI.updateContext();
          },
          updateContext: () => {
            if( layerButton.classList.contains( "active" ) )
              duplicateButton.classList.remove( "hidden" );
            else duplicateButton.classList.add( "hidden" );
          }
        },
        { tooltip: [ "Duplicate Layer", "above", "to-left-of-center" ], zIndex:1000 }
      )
      layerButton.appendChild( duplicateButton );
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
      layerButton.appendChild( deleteButton );
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
              document.querySelectorAll( ".layer-node-tail" ).forEach( n => nodeLinkSource.removeChild( n ) );
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
              reorganizeLayerButtons();
            }
          },
        },
        { tooltip: [ "Reorganize Layer", "to-left", "vertical-center" ], zIndex:1000 },
      )
      layerButton.appendChild( moveHandle );
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
            console.log( "Showing." );
            const textInput = document.querySelector( "#multiline-text-input-overlay" );
            textInput.setText( newLayer.layerName );
            textInput.onapply = text => {
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
            textInput.show();
          },
          updateContext: () => {
            layerNameText.textContent = newLayer.layerName;
          }
        },
        { tooltip: [ `Rename Layer [${newLayer.layerName}]`, "above", "to-left-of-center" ], zIndex:1000 },
      )
      layerButton.appendChild( layerName );
    }

    /* {
      //the lineart button (temp, I think)
      const lineartButton = document.createElement( "button" );
      lineartButton.classList.add( "lineart" );
      lineartButton.textContent = "✎";
      registerUIElement( lineartButton, { onclick: async () => {
        //adding the new layer inherently adds the undo component
        const copy = await addCanvasLayer( "paint", lw, lh, newLayer );
        //by altering the properties without registering a new undo, the creation undo is a copy
        copy.topLeft = [ ...newLayer.topLeft ];
        copy.topRight = [ ...newLayer.topRight ];
        copy.bottomLeft = [ ...newLayer.bottomLeft ];
        copy.bottomRight = [ ...newLayer.bottomRight ];
        //get the image
        console.error( "Async lineart generator needs to lock the UI but it's switching to gen controls anyway probably...");
        const srcImg = newLayer.canvas.toDataURL();
        const img = await getLineartA1111( {image:srcImg,res:1024,module:"lineart_realistic"} );
        copy.context.drawImage( img, 0, 0 );
        //turn white-black into black-alpha
        const data = copy.context.getImageData( 0,0,copy.w,copy.h ),
          d = data.data;
        for( let i=0; i<d.length; i+=4 ) {
          d[i+3] = d[i];
          d[i]=d[i+1]=d[i+2] = 0;
        }
        copy.context.putImageData( data,0,0 );
        copy.textureChanged = true;
      } } );
      layerButton.appendChild( lineartButton );
    } */

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
              //save the current, un-merged lower layer
              const oldData = lowerLayer.context.getImageData( 0,0,lowerLayer.w,lowerLayer.h );

              //this layer can't be a group layer, because those can't be merged.
              //(They can be flattened to paint layers though.)

              //sample this layer onto the lower layer
              let previewLayer = layersStack.layers.find( l => l.layerType === "paint-preview" );
              sampleLayerInLayer( newLayer, lowerLayer, previewLayer );

              //merge the sampled area onto the lower layer
              lowerLayer.context.save();
              lowerLayer.context.globalAlpha = newLayer.opacity;
              lowerLayer.context.drawImage( previewLayer.canvas, 0, 0 );
              lowerLayer.context.restore();
              //flag the lower layer for GPU upload
              flagLayerTextureChanged( lowerLayer );
              //delete this upper layer from the stack
              layersStack.layers.splice( index, 1 );
              //remember this upper layer's parent and sibling for DOM-reinsertion
              const domSibling = newLayer.layerButton.nextElementSibling,
                domParent = newLayer.layerButton.parentElement;
              //remove this upper layer from DOM
              domParent.removeChild( newLayer.layerButton );
              //select the lower layer
              selectLayer( lowerLayer );
              
              const historyEntry = {
                index,
                upperLayer: newLayer,
                domSibling, domParent,
                lowerLayer,
                oldData,
                newData: null,
                undo: () => {
                  if( historyEntry.newData === null ) {
                    historyEntry.newData = lowerLayer.context.getImageData( 0,0,lowerLayer.w,lowerLayer.h );
                  }
                  //restore the lower layer's data
                  lowerLayer.context.putImageData( historyEntry.oldData, 0, 0 );
                  //and flag it for GPU upload
                  flagLayerTextureChanged( historyEntry.lowerLayer );
                  //reinsert the upper layer into the layer's stack
                  layersStack.layers.splice( historyEntry.index, 0, historyEntry.upperLayer );
                  //reinsert the upper layer into the DOM
                  historyEntry.domParent.insertBefore( historyEntry.upperLayer.layerButton, historyEntry.domSibling );
                  
                  reorganizeLayerButtons();
                  UI.updateContext();

                },
                redo: () => {
                  //delete the upper layer from the stack
                  layersStack.layers.splice( historyEntry.index, 1 );
                  //remove it from the DOM
                  historyEntry.domParent.removeChild( historyEntry.upperLayer.layerButton );
                  //blit the merged data agaain
                  historyEntry.lowerLayer.context.putImageData( historyEntry.newData, 0, 0 );
                  //and flag for GPU upload
                  flagLayerTextureChanged( historyEntry.lowerLayer );
                  
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
      layerButton.appendChild( mergeButton );
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

            //update the layer type icon
            layerButton.querySelector( ".layer-type-icon" ).classList.remove( "generative" );
            layerButton.querySelector( ".layer-type-icon" ).classList.add( "paint" );
    
            selectLayer( newLayer );
    
            const historyEntry = {
              newLayer,
              poppedUplinks,
              undo: () => {
                historyEntry.newLayer.layerType = "generative";
                //reinstall popped uplinks
                for( const [uplinkingLayer,uplink] of historyEntry.poppedUplinks )
                  uplinkingLayer.nodeUplinks.add( uplink );
                //update the layer type icon
                layerButton.querySelector( ".layer-type-icon" ).classList.add( "generative" );
                layerButton.querySelector( ".layer-type-icon" ).classList.remove( "paint" );
          
                UI.updateContext();
              },
              redo: () => {
                historyEntry.newLayer.layerType === "paint";
                //repop popped uplinks
                for( const [uplinkingLayer,uplink] of historyEntry.poppedUplinks )
                  uplinkingLayer.nodeUplinks.delete( uplink );
                //update the layer type icon
                layerButton.querySelector( ".layer-type-icon" ).classList.remove( "generative" );
                layerButton.querySelector( ".layer-type-icon" ).classList.add( "paint" );
          
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
      
      layerButton.appendChild( convertToPaintbutton );
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
              const apiFlowName = selectedLayer.generativeSettings.apiFlowName;
              const controlsRow = document.querySelector( "#generative-controls-row" ),
                controlsPanel = document.querySelector( "#generative-controls-panel" );
              if( ! controlsRow.classList.contains( "hidden" ) ) {
                //get all image input controls
                const controlElements = document.querySelectorAll( ".image-input-control" );
                for( const controlElement of controlElements ) {
                  const controlRect = controlElement.getClientRects()[ 0 ];
                  if( current.x >=  controlRect.left && current.y >= controlRect.top && current.x <= controlRect.right && current.y <= controlRect.bottom ) {
                    

                    //if this control element already had an existing uplink layer, erase the link
                    if( controlElement.uplinkLayer ) {
                      for( const uplink of controlElement.uplinkLayer.nodeUplinks ) {
                        if( uplink.layerId === selectedLayer.layerId && uplink.apiFlowName === apiFlowName && uplink.controlName === controlElement.controlName ) {
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
                      apiFlowName: controlsPanel.apiFlowName,
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


    //insert the layer buttom into the DOM
    /* if( nextSibling ) {
      document.querySelector( "#layers-column" ).insertBefore( layerButton, nextSibling.layerButton );
      layerSibling = nextSibling.layerButton;
    } else {
      const firstLayer = document.querySelector( "#layers-column > .layer" );
      if( firstLayer ) {
        layerSibling = firstLayer;
        document.querySelector( "#layers-column" ).insertBefore( layerButton, layerSibling );
      }
      else {
        document.querySelector( "#layers-column" ).appendChild( layerButton );
      }
    } */

    //activate the layer
    if( ! doNotUpdate )
      selectLayer( newLayer );
  }

  if( layerType !== "paint-preview" ) {
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

  //pop all the buttons
  document.querySelectorAll( ".layer-button" ).forEach( lb => lb.parentElement.removeChild( lb ) );

  const layersColumn = document.querySelector( "#layers-column" );

  //reinstall in order
  for( let i=layersStack.layers.length-1; i>=0; i-- ) {
    const layer = layersStack.layers[ i ];
    if( layer.layerType === "paint-preview" ) continue;
    if( checkLayerInsideClosedGroup( layer ) ) continue;
    if( layer.layerType === "group" && layer === selectedLayer ) {
      updateLayerGroupCoordinates( layer );
      if( layer.groupClosed === false ) layer.layerButton.querySelector( ".layer-type-icon.group" ).classList.add( "open" );
      if( layer.groupClosed === true ) layer.layerButton.querySelector( ".layer-type-icon.group" ).classList.remove( "open" );
    }
    layersColumn.appendChild( layer.layerButton );
    const layerGroupDepth = Math.min( 5, getLayerGroupDepth( layer ) );
    if( layerGroupDepth > 0 ) {
      layer.layerButton.classList.add( "layer-in-group", "layer-group-depth-" + layerGroupDepth );
    }
    else layer.layerButton.classList.remove( "layer-in-group" );
  }

}

//after sampleLayerInLayer, we'll swap out the img2img pull code with sampling like this

function sampleLayerInLayer( sourceLayer, rectLayer, compositingLayer ) {

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
  
  console.log( castPoints, sourceRotation, sourceToplegLength, sourceSideLegLength );

  //draw to the compositing layer
  const ctx = compositingLayer.context;
  ctx.save();
  ctx.clearRect( 0,0,rectLayer.w,rectLayer.h );
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
  composeLayers( layer, childLayers, 1 );
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

  console.log( minX, maxX, minY, maxY );

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

  let pointInSelectedLayer = false;

  //cast global points to our selected layer's space
  for( const point of points ) {
    let [x,y] = point;
    //translate from origin
    x -= origin.x; y -= origin.y;
    //project on normals
    let xProjection = x*normalizedXLeg.x + y*normalizedXLeg.y;
    let yProjection = x*normalizedYLeg.x + y*normalizedYLeg.y;
    //unnormalize
    xProjection *= selectedLayer.w / xLegLength;
    yProjection *= selectedLayer.h / yLegLength;
    //check if the point is inside the layer bounds
    if( xProjection >= 0 && xProjection <= selectedLayer.w && yProjection >= 0 && yProjection <= selectedLayer.h ) {
      pointInSelectedLayer = true;
      break;
    }
  }

  return pointInSelectedLayer;

}

function floodFillLayer( layer, layerX, layerY ) {

  const imageData = layer.context.getImageData( 0, 0, layer.w, layer.h );
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

  let { tolerance, floodTarget } = uiSettings.toolsSettings[ "flood-fill" ];
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
        
        //to the left
        i = ((y*w)+x-1) * 4;
        if( island[ i/4 ] === 0 ) {
          dr = d[ i ] - lr; dg = d[ i+1 ] - lg; db = d[ i+2 ] - lb; da = d[ i+3 ] - la;
          dist = Math.sqrt( dr**2 + dg**2 + db**2 + da**2 );
          if( dist < tolerance ) {
            d[ i ] = r; d[ i+1 ] = g; d[ i+2 ] = b; d[ i+3 ] = 255;
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
            d[ i ] = r; d[ i+1 ] = g; d[ i+2 ] = b; d[ i+3 ] = 255;
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
            d[ i ] = r; d[ i+1 ] = g; d[ i+2 ] = b; d[ i+3 ] = 255;
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
            d[ i ] = r; d[ i+1 ] = g; d[ i+2 ] = b; d[ i+3 ] = 255;
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

  const changedRect = {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY
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

function composeLayers( destinationLayer, layers, pixelScale=1 ) {

  let minX = Infinity, minY = Infinity,
    maxX = -Infinity, maxY = -Infinity;
  for( const layer of layers ) {
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

  console.log( width, height );

  destinationLayer.canvas.width = width;
  destinationLayer.canvas.height = height;
  
  const ctx = destinationLayer.context;
  ctx.save();
  //translate so our minXY is at 0
  ctx.translate( -minX, -minY );
  //draw our layers
  for( const layer of layers ) {
      const [x,y] = layer.topLeft,
        [x2,y2] = layer.topRight;
      const dx = x2-x, dy=y2-y;
      const l = Math.sqrt( dx*dx + dy*dy );
      ctx.save();
      ctx.translate( x, y );
      ctx.rotate( Math.atan2( dy, dx ) );
      ctx.scale( l / layer.w, l / layer.h );
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
      /* ctx.lineWidth = 1.0;
      
      ctx.strokeStyle = "black";
      ctx.strokeRect( 0, 0, layer.canvas.width, layer.canvas.height ); */
      ctx.restore();
  }

  ctx.restore();
  
}

function flagLayerTextureChanged( layer, rect=null ) {
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
  let groupChainLayer = layer;
  while( groupChainLayer.layerGroupId !== null ) {
    const groupLayer = layersStack.layers.find( l => l.layerId ===groupChainLayer.layerGroupId )
    //if( ! groupLayer ) { console.error( "Layer missing declared group: ", groupChainLayer ); }
    groupLayer.groupCompositeUpToDate = false;
    groupChainLayer = groupLayer;
  }
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
  let groupChainLayer = layer;
  while( groupChainLayer.layerGroupId !== null ) {
    const groupLayer = layersStack.layers.find( l => l.layerId ===groupChainLayer.layerGroupId )
    //if( ! groupLayer ) { console.error( "Layer missing declared group: ", groupChainLayer ); }
    groupLayer.groupCompositeUpToDate = false;
    groupChainLayer = groupLayer;
  }
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

function getLayerVisibility( layer ) {
  if( layer.visible === false ) return false;
  if( layer.layerGroupId === null && layer.visible === true ) return true;
  return getLayerVisibility( layersStack.layers.find( l => l.layerId === layer.layerGroupId ) );
}
function getLayerOpacity( layer ) {
  let alpha = layer.opacity;
  if( layer.layerGroupId === null ) return alpha;
  return alpha * getLayerOpacity( layersStack.layers.find( l => l.layerId === layer.layerGroupId ) );
}

async function resetLayerSize( layer, width, height ) {

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

  //whatever process called this function had better flag it for upload!

}

async function deleteLayer( layer ) {

  //if this layer is selected, unselect it
  if( selectedLayer === layer ) selectedLayer = null;
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
      if( searchLayer.layerType === "paint-preview" ) continue;
      nextLayer = searchLayer;
      break;
    }
  }
  if( ! nextLayer && index > 0 ) {
    //search for a non-preview layer
    for( let i=index-1; i>=0; i-- ) {
      const searchLayer = layersStack.layers[ i ];
      if( searchLayer.layerType === "paint-preview" ) continue;
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
  layer.maskChanged = true;
  layer.maskChangedRect.x = 0;
  layer.maskChangedRect.y = 0;
  layer.maskChangedRect.w = layer.w;
  layer.maskChangedRect.h = layer.h;

  layer.layerButton.appendChild( layer.maskCanvas );

  layer.maskInitialized = true;
}

function selectLayer( layer ) {
  if( selectedLayer ) {
    selectedLayer.layerButton.querySelector( ".layer-name" ).uiActive = false;
    //not visually hidden, just non-hoverable in UI
    selectedLayer.layerButton.querySelector( ".layer-name" ).classList.add( "no-hover" );
  }
  selectedLayer = layer;
  if( layer.layerType === "group" ) {
    updateLayerGroupCoordinates( layer );
  }
  for( const l of document.querySelectorAll( "#layers-column > .layer-button" ) ) {
    l.classList.remove( "active", "no-hover", "hovering" );
  }
  layer.layerButton.classList.add( "active", "no-hover" );
  layer.layerButton.classList.remove( "hovering" );
  layer.layerButton.querySelector( ".layer-name" ).uiActive = true;
  layer.layerButton.querySelector( ".layer-name" ).classList.remove( "no-hover" );

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

    if( false )
    document.querySelector("#console" ).textContent = 
`20-frame FPS:  + ${fps.toString().substring(0,5)}
Info: ${info}`;

    if( looping ) window.requestAnimationFrame( Loop );
    
    updateCycle( t );

    
    //writeInfo();

    
    if( glState.ready ) {

      //for each layer:
      // get its transformed points.
      // upload those transformed points to the vertex buffer
      // activate the layer's texture
      // if the layer has changed, reupload its canvas
      // draw the layer with a draw call (don't optimize, iterate)
      
      gl.clearColor(0.26,0.26,0.26,1); //slight color to see clear effect
      gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
      gl.useProgram( glState.program );
      gl.bindVertexArray(glState.vao);

      //TODO: Here we need to collect all transforming layers, if any
      const visibleLayers = [],
        selectedGroupLayers = [];
      let paintPreviewLayer = null;
      for( const layer of layersStack.layers ) {
        if( layer.layerType === "paint-preview" && paintPreviewLayer === null ) {
          paintPreviewLayer = layer;
          continue;
        }
        if( layer.layerType === "group" ) {
          if(  layer !== selectedLayer ) {
            continue;
          }
          else if( layer === selectedLayer ) {
            //grab layers within selected layer group to show their borders. :-)
            selectedGroupLayers.push( ...collectGroupedLayersAsFlatList( layer.layerId ) );
          }
        }
        if( getLayerVisibility( layer ) ) {
          visibleLayers.push( layer );
        }
      }
      
      if( selectedLayer && painter.active && painter.queue.length > 1 ) {
        visibleLayers.splice( visibleLayers.indexOf( selectedLayer )+1, 0, paintPreviewLayer );
      } else {
        visibleLayers.push( paintPreviewLayer );
      }

      getTransform();

      continueLayers:
      for( const layer of visibleLayers ) {

        //eraser preview requires real layer undrawn
        if( layer === selectedLayer &&
            ( uiSettings.activeTool === "paint" || uiSettings.activeTool === "mask" ) &&
            ( uiSettings.toolsSettings.paint.mode === "erase" || uiSettings.toolsSettings.paint.mode === "blend" ) && 
            !( uiSettings.activeTool === "mask" && uiSettings.toolsSettings.paint.mode === "erase" ) &&
              painter.active && painter.queue.length > 1 ) {
              //if we're erasing or blending, we do opacity at the brush-level. :-/
              //That means you can "paint into the fog", a fundamentally different brush experience. Oh well.
              //Might have to change it for painting too to be consistent...
              console.log( "Skipping" );
              continue continueLayers;
            }

        if( layer === paintPreviewLayer ) {
          if( uiSettings.activeTool === "paint" ) {
            layer.opacity = uiSettings.toolsSettings.paint.modeSettings.all.brushOpacity;
            //If we're erasing, we draw this at full opacity, and draw the under-layer at 1-brushOpacity
            if( ( uiSettings.toolsSettings.paint.mode === "erase" || uiSettings.toolsSettings.paint.mode === "blend" ) &&
                painter.active && painter.queue.length > 1 ) {
              layer.opacity = selectedLayer.opacity;
            }
          }
          if( uiSettings.activeTool === "mask" ) {
            layer.opacity = 0.5;
          }
        } 

        let [x,y] = transformPoint( layer.topLeft ),
          [x2,y2] = transformPoint( layer.topRight ),
          [x3,y3] = transformPoint( layer.bottomLeft ),
          [x4,y4] = transformPoint( layer.bottomRight );
        //this unpacking and repacking is because of array re-use
        let xy = [x,y,1]; xy2 = [x2,y2,1]; xy3 = [x3,y3,1]; xy4 = [x4,y4,1];


        //TODO: This transform actually needs to happen for all layers that are transforming (if we're transforming a group)
        //transform the layer if we're mid-transform
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

        //get the layers physical size on-display
        let layerSizePixels;
        {
          const dx = xy2[0] - xy[0], dy = xy2[1] - xy[1];
          layerSizePixels = Math.sqrt( dx**2 + dy**2 );
        }

        //convert that screenspace to GL space
        const glOriginX = W/2, glOriginY = H/2;
        for( const p of [xy,xy2,xy3,xy4] ) {
          p[0] -= glOriginX; p[1] -= glOriginY;
          //We're flipping the y coordinate! OpenGL NDC space defines the bottom of the screen as -1 y, and the top as +1 y (center 0).
          p[0] /= glOriginX; p[1] /= -glOriginY;
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
          srcFormat = gl.RGBA,
          srcType = gl.UNSIGNED_BYTE;
          gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, layer.canvas );
          layer.textureChanged = false;
        }

        //bind the layer's mask
        gl.activeTexture( gl.TEXTURE0 + 1 );
        gl.bindTexture( gl.TEXTURE_2D, layer.glMask );
        if( layer.layerType !== "group" && layer.maskChanged ) {
          //re-upload the layer's mask when it's changed
          const mipLevel = 0,
          internalFormat = gl.RGBA,
          srcFormat = gl.RGBA,
          srcType = gl.UNSIGNED_BYTE;
          gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, layer.maskCanvas );
          layer.maskChanged = false;
        }

        //set the layer's alpha
        gl.uniform1f( glState.alphaInputIndex, getLayerOpacity( layer ) );
        let maskVisibility = 0.0;
        if( layer === selectedLayer && uiSettings.activeTool === "mask" && layer.maskInitialized && painter.active && painter.queue.length )
          maskVisibility = 0.5;
        gl.uniform1f( glState.alphaMaskIndex, maskVisibility );
        gl.uniform1f( glState.timeIndex, floatTime );

        let borderIsVisible = layer === selectedLayer;

        //disable border while transform group to avoid recalculating coordinates every cycle (and visuals are confusing anyway)
        if( layer.layerType === "group" && uiSettings.activeTool === "transform" && uiSettings.toolsSettings.transform.current === true && ( cursor.mode !== "none" || pointers.count === 2 ) )
          borderIsVisible = false;

        if( borderIsVisible === false && selectedLayer?.layerType === "group" && selectedGroupLayers.includes( layer ) )
          borderIsVisible = true;

        gl.uniform1f( glState.borderVisibilityIndex, borderIsVisible ? 0.33 : 0.0 ); //for now, all visible
        gl.uniform1f( glState.borderWidthIndex, 2.0 / layerSizePixels ); //2 pixel border width

        //set the uniform to point at texture zero
        gl.uniform1i( gl.getUniformLocation( glState.program, "img" ), 0 );
        //set the uniform to point at texture one
        gl.uniform1i( gl.getUniformLocation( glState.program, "imgMask" ), 1 );
        {
          //and draw our triangles
          const primitiveType = gl.TRIANGLES,
            structStartOffset = 0,
            structCount = 6;
          gl.drawArrays( primitiveType, structStartOffset, structCount );
        }
      }

      //get the eyedropper color
      if( airInput.active ) {
        airInput.updateEyedropper();
      }

    }

}


function setup() {


    document.body.appendChild( main );
    //main.appendChild( cnv );
    main.appendChild( gnv );
    main.appendChild( uiContainer );
    main.appendChild( overlayContainer );

    const img = new Image();
    img.src = "paper.png";
    img.onload = () => {
      //paperTexture = ctx.createPattern( img, "repeat" );
      //setup GL temporarily inside img onload for texture test
      setupGL( img );  
    }


    setupUI();

    resizeCanvases();

    window.addEventListener( "resize", resizeCanvases );

    //populate demopoints
    //for( let i=0; i<10; i++ ) { demoPoints.push( [ Math.random()*W , Math.random()*H , 1 ] ); }
    {
        let w = 1024, h = 1024;
        let x1 = W/2 - w/2, y1 = H/2 - h/2,
            x2 = W/2 + w/2, y2 = H/2 + h/2;
        //demoPoints.push( [ 0 , 0 , 1 ] , [ W , 0 , 1 ] , [ W, H , 1 ] , [ 0 , H , 1 ] , [ 0 , 0 , 1 ], null );
        demoPoints.push( [ x1, y1 , 1 ] , [ x2, y1 , 1 ] , [ x2, y2 , 1 ] , [ x1, y2 , 1 ] , [ x1, y1 , 1 ], null );
    }

    window.onkeydown = k => { if( k.code === "Escape" ) {
        looping = false; 
        console.log( "Stopped looping." );
    } }

    gnv.addEventListener( "pointerdown" ,  p => startHandler( p ) );
    gnv.addEventListener( "pointermove" , p => moveHandler( p ) );
    gnv.addEventListener( "pointerup" , p => stopHandler( p ) );
    gnv.addEventListener( "pointerout" , p => stopHandler( p ) );
    gnv.addEventListener( "pointercancel" , p => stopHandler( p ) );
    gnv.addEventListener( "pointerleave" , p => stopHandler( p ) );
    gnv.addEventListener( "contextmenu" , p => contextMenuHandler( p ) );

    gnv.addEventListener( "auxclick" , p => cancelEvent );

    enableKeyTrapping();

    //setup two paint preview layers (some ops need double-buffering)
    addCanvasLayer( "paint-preview" );
    addCanvasLayer( "paint-preview" );

    window.requestAnimationFrame( Loop );

    
    //getImageA1111("a kitten drawing with a pen on a digital art tablet");

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
};
function setupGL( testImageTexture ) {

  gl.disable(gl.DEPTH_TEST);
  
  gl.enable( gl.BLEND );
  gl.blendFunc( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA );

  gl.clearColor(0,0,0,1);
  gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );


  //push some code to the GPU
  const vertexShaderSource = `#version 300 es
    in vec4 xyuv;

    out vec2 uv;
    
    void main() {
      uv = xyuv.zw;
      gl_Position = vec4(xyuv.xy,0.5,1);
    }`;
  const fragmentShaderSource = `#version 300 es
    precision highp float;
    
    uniform sampler2D img;
    uniform sampler2D imgMask;
    uniform float alpha;
    uniform float mask;
    uniform float time;
    uniform float borderVisibility;
    uniform float borderWidth;
    in vec2 uv;
    out vec4 outColor;
    
    void main() {
      vec4 lookup = texture(img,uv);
      vec4 maskLookup = texture(imgMask,uv);
      lookup.a *= alpha * maskLookup.a;

      if( lookup.a < 0.01 ) {
        lookup = vec4( 1.0,1.0,1.0, mask * maskLookup.a );
      }

      float onBorder = float( uv.x < borderWidth || uv.x > (1.0-borderWidth) || uv.y < borderWidth || uv.y > (1.0-borderWidth) );
      float borderShade = abs( mod( ( ( time - ( uv.x + uv.y ) ) * 0.1 / borderWidth ), 2.0 ) - 1.0 );

      outColor = mix( lookup, vec4( borderShade,borderShade,borderShade,1.0 ), onBorder * borderVisibility );

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

const nonSavedSettingsPaths = [
  "toolsSettings.paint.modeSettings.brushTipsImages",
]

let uiSettings = {

  gpuPaint: false,

  maxUndoSteps: 20,
  defaultLayerWidth: 1024,
  defaultLayerHeight: 1024,

  //defaultAPIFlowName: "A1111 Lightning Demo txt2img Mini",
  defaultAPIFlowName: "Comfy SD1.5/SDXL txt2img",
  retryAPIDelay: 2000,

  setActiveTool: tool => {
    uiSettings.activeTool = tool;
    UI.updateContext();
  },

  activeTool: null, //null | generate | paint | mask | transform | flood-fill | text-tool
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
          brushTips: ["res/img/brushes/tip-pencil01.png"],
          brushTipsImages: [],
          brushTiltScale: 4,
          brushTiltMinAngle: 0.25, //~23 degrees
          brushSize: 14,
          minBrushSize: 2,
          maxBrushSize: 16,
          brushOpacity: 1,
          brushBlur: 0,
          minBrushBlur: 0,
          maxBrushBlur: 0.25,
          brushSpacing: 0.1,
          pressureOpacityCurve: pressure => pressure,
          pressureScaleCurve: pressure => 1,
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
          blendBlur: 0,
          reblendSpacing: 0.05,
          reblendAlpha: 0.1,
        },
        "erase": {

        }
      },
    },
    "mask": {
      maskColor: "rgb(255,255,255)", //might make configurable or change eventually, but not implemented yet
    },
    "transform": {
      current: true,
      transformingLayers: [],
    },
    "flood-fill": {
      tolerance: 0.1,
      floodTarget: "area", //"area" | "color"
    }
  },

  /* paint: { r:200,g:220,b:240 },
  get paintColor(){
    const {r,g,b} = uiSettings.paint;
    return `rgb(${r},${g},${b})`;
  },
  mask: false,
  brush: "paint",
  pressureEnabled: true,
  //brushEngine: "pencil",
  brushEngine: "blend",
  brushTiltScaleAdd: 20.0,
  brushSize: 14,
  brushOpacity: 1,
  brushBlur: 0,
  brushProfile: p => uiSettings.brushSize, */

  nodeSnappingDistance: Math.min( innerWidth, innerHeight ) * 0.04, //~50px on a 1080p screen

}

const loadedBrushTipsImages = {};
function loadBrushTipsImages() {
  uiSettings.toolsSettings.paint.modeSettings.all.brushTipsImages.length = 0;
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
}

loadBrushTipsImages();

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
      UI.registerElement(
        generateButton,
        {
          onclick: () => {
            if( ! generateButton.classList.contains( "unavailable" ) ) {
              uiSettings.setActiveTool( "generate" );
              setupUIGenerativeControls( selectedLayer.generativeSettings.apiFlowName );
              document.querySelector( "#generative-controls-row" ).classList.remove( "hidden" );
            }
          },
          updateContext: () => {
            //if not generative layer selected, unavailable
            if( selectedLayer?.layerType !== "generative" ) {
              generateButton.classList.add( "unavailable" );
              generateButton.querySelector(".tooltip" ).textContent = "AI Generation Tool [Select generative layer to enable]";
              generateButton.classList.remove( "on" );
              if( uiSettings.activeTool === "generate" )
                uiSettings.setActiveTool( null );
            }

            //if just switched to generative layer, and paint tool is still active, make this the active
            if( false && selectedLayer?.layerType === "generative" && ( generateButton.classList.contains( "unavailable" ) || uiSettings.activeTool === "paint" ) ) {
              //just switched to gen layer, should display gen controls right away, no?
              //absolutely have to stop displaying paint tool, if that's what we're on
              generateButton.classList.remove( "unavailable" );
              generateButton.classList.add( "on" );
              setupUIGenerativeControls( selectedLayer.generativeSettings.apiFlowName );
              uiSettings.setActiveTool( "generate" );
            }

            //if / ifnot the active tool, on/noton
            if( uiSettings.activeTool === "generate" ) {
              generateButton.classList.add( "on" );
            } else {
              generateButton.classList.remove( "on" );
            }

            //mark if available
            if( selectedLayer?.layerType === "generative" ) {
              generateButton.classList.remove( "unavailable" );
              generateButton.querySelector(".tooltip" ).textContent = "AI Generation Tool";
            }

            },
        },
        { tooltip: [ "AI Generation Tool", "to-right", "vertical-center" ] }
      )
    }

    //the paint button
    {
      const paintButton = document.createElement( "div" );
      paintButton.classList.add( "tools-column-paint-button", "round-toggle", "animated", "unavailable" );
      toolsColumn.appendChild( paintButton );
      UI.registerElement(
        paintButton,
        {
          onclick: () => {
            if( ! paintButton.classList.contains( "unavailable" ) ) {
              uiSettings.setActiveTool( "paint" )
            }
          },
          updateContext: () => {
            //if not paint layer selected, unavailable
            if( selectedLayer?.layerType !== "paint" ) {
              paintButton.classList.add( "unavailable" );
              paintButton.querySelector(".tooltip" ).textContent = "Paint Tool [Select paint layer to enable]";
              paintButton.classList.remove( "on" );
              if( uiSettings.activeTool === "paint" )
                uiSettings.setActiveTool( null );
            } else {
              paintButton.classList.remove( "unavailable" );
              paintButton.querySelector(".tooltip" ).textContent = "Paint Tool";
            }

            
            if( uiSettings.activeTool === "paint" ) {
              paintButton.classList.add( "on" );
            } else {
              paintButton.classList.remove( "on" );
            }
          },
        },
        { tooltip: [ "Paint Tool", "to-right", "vertical-center" ] }
      )
    }

    //the mask button
    {
      const maskButton = document.createElement( "div" );
      maskButton.classList.add( "tools-column-mask-button", "round-toggle", "animated", "unavailable" );
      toolsColumn.appendChild( maskButton );
      UI.registerElement(
        maskButton,
        {
          onclick: () => {
            if( ! maskButton.classList.contains( "unavailable" ) ) {
              uiSettings.setActiveTool( "mask" )
            }
          },
          updateContext: () => {
            //if no layer selected, unavailable
            if( ! selectedLayer || [ "group","pose" ].includes( selectedLayer.layerType ) ) {
              maskButton.classList.add( "unavailable" );
              maskButton.querySelector(".tooltip" ).textContent = "Mask Tool [Select paint, text, or generative layer to enable]";
              maskButton.classList.remove( "on" );
            } else {
              maskButton.classList.remove( "unavailable" );
              maskButton.querySelector(".tooltip" ).textContent = "Mask Tool";
              if( uiSettings.activeTool === "mask" ) maskButton.classList.add( "on" );
              else maskButton.classList.remove( "on" );
            }
          },
        },
        { tooltip: [ "Mask Tool", "to-right", "vertical-center" ] }
      )
    }

    //the transform button
    {
      const transformButton = document.createElement( "div" );
      transformButton.classList.add( "tools-column-transform-button", "round-toggle", "animated", "unavailable" );
      toolsColumn.appendChild( transformButton );
      UI.registerElement(
        transformButton,
        {
          onclick: () => {
            if( ! transformButton.classList.contains( "unavailable" ) ) {
              uiSettings.setActiveTool( "transform" )
            }
          },
          updateContext: () => {

            if( transformButton.classList.contains( "unimplemented" ) ) {
              transformButton.classList.add( "unavailable" );
              transformButton.classList.remove( "on" );
              transformButton.querySelector(".tooltip" ).textContent = "!Unimplemented! Transform Tool" + (selectedLayer ? "" : " [Select layer to enable]");
              return;
            }
            //if no layer selected, unavailable
            if( ! selectedLayer ) {
              transformButton.classList.add( "unavailable" );
              transformButton.querySelector(".tooltip" ).textContent = "Transform Tool [Select layer to enable]";
              transformButton.classList.remove( "on" );
            } else {
              transformButton.classList.remove( "unavailable" );
              transformButton.querySelector(".tooltip" ).textContent = "Transform Tool";
              if( uiSettings.activeTool === "transform" ) transformButton.classList.add( "on" );
              else transformButton.classList.remove( "on" );
            }
          },
        },
        { tooltip: [ "Transform Tool", "to-right", "vertical-center" ] }
      )
    }

    //the flood fill button
    {
      const floodFillButton = document.createElement( "div" );
      floodFillButton.classList.add( "tools-column-flood-fill-button", "round-toggle", "animated", "unavailable" );
      //floodFillButton.classList.add( "tools-column-flood-fill-button", "round-toggle", "animated", "unimplemented", "unavailable" );
      toolsColumn.appendChild( floodFillButton );
      UI.registerElement(
        floodFillButton,
        {
          onclick: () => {
            if( ! floodFillButton.classList.contains( "unavailable" ) && ! floodFillButton.classList.contains( "unimplemented" ) ) {
              console.log( "Setting active tool to floodfill." );
              uiSettings.setActiveTool( "flood-fill" );
            }
          },
          updateContext: () => {

            if( floodFillButton.classList.contains( "unimplemented" ) ) {
              floodFillButton.classList.add( "unavailable" );
              floodFillButton.classList.remove( "on" );
              floodFillButton.querySelector(".tooltip" ).textContent = "!Unimplemented! Flood Fill Tool" + (selectedLayer ? "" : " [Select paint layer to enable]");
              return;
            }
            //if no layer selected, unavailable
            if( ! selectedLayer?.layerType === "paint" ) {
              floodFillButton.classList.add( "unavailable" );
              floodFillButton.querySelector(".tooltip" ).textContent = "Flood Fill Tool [Select paint layer to enable]";
              floodFillButton.classList.remove( "on" );
            } else {
              floodFillButton.classList.remove( "unavailable" );
              floodFillButton.querySelector(".tooltip" ).textContent = "Flood Fill Tool";
              if( uiSettings.activeTool === "flood-fill" ) {
                floodFillButton.classList.add( "on" );
              }
              else floodFillButton.classList.remove( "on" );
            }
          },
        },
        { tooltip: [ "Flood Fill Tool", "to-right", "vertical-center" ] }
      )
    }
    
    //the text tool button
    {
      const textToolButton = document.createElement( "div" );
      textToolButton.classList.add( "tools-column-text-tool-button", "round-toggle", "animated", "unimplemented", "unavailable" );
      toolsColumn.appendChild( textToolButton );
      UI.registerElement(
        textToolButton,
        {
          onclick: () => {
            if( ! textToolButton.classList.contains( "unavailable" ) && ! textToolButton.classList.contains( "unimplemented" ) ) {
              uiSettings.setActiveTool( "text-tool" )
            }
          },
          updateContext: () => {

            if( textToolButton.classList.contains( "unimplemented" ) ) {
              textToolButton.classList.add( "unavailable" );
              textToolButton.classList.remove( "on" );
              textToolButton.querySelector(".tooltip" ).textContent = "!Unimplemented! Text Tool" + (selectedLayer ? "" : " [Select text layer to enable]");
              return;
            }
            //if no layer selected, unavailable
            if( ! selectedLayer?.layerType === "text" ) {
              textToolButton.classList.add( "unavailable" );
              textToolButton.querySelector(".tooltip" ).textContent = "Text Tool [Select text layer to enable]";
              textToolButton.classList.remove( "on" );
            } else {
              textToolButton.classList.remove( "unavailable" );
              textToolButton.querySelector(".tooltip" ).textContent = "Text Tool";
              if( uiSettings.activeTool === "text-tool" ) textToolButton.classList.add( "on" );
              else textToolButton.classList.remove( "on" );
            }
          },
        },
        { tooltip: [ "Flood Fill Tool", "to-right", "vertical-center" ] }
      )
    }
    
    //the pose tool button
    {
      const poseButton = document.createElement( "div" );
      poseButton.classList.add( "tools-column-pose-button", "round-toggle", "animated", "unimplemented", "unavailable" );
      toolsColumn.appendChild( poseButton );
      UI.registerElement(
        poseButton,
        {
          onclick: () => {
            if( ! poseButton.classList.contains( "unavailable" ) && ! poseButton.classList.contains( "unimplemented" ) ) {
              uiSettings.setActiveTool( "pose" )
            }
          },
          updateContext: () => {

            if( poseButton.classList.contains( "unimplemented" ) ) {
              poseButton.classList.add( "unavailable" );
              poseButton.classList.remove( "on" );
              poseButton.querySelector(".tooltip" ).textContent = "!Unimplemented! Pose Tool" + (selectedLayer ? "" : " [Select pose layer to enable]");
              return;
            }
            //if no layer selected, unavailable
            if( ! selectedLayer?.layerType === "pose" ) {
              poseButton.classList.add( "unavailable" );
              poseButton.querySelector(".tooltip" ).textContent = "Pose Tool [Select pose layer to enable]";
              poseButton.classList.remove( "on" );
            } else {
              poseButton.classList.remove( "unavailable" );
              poseButton.querySelector(".tooltip" ).textContent = "Pose Tool";
              if( uiSettings.activeTool === "pose" ) poseButton.classList.add( "on" );
              else poseButton.classList.remove( "on" );
            }
          },
        },
        { tooltip: [ "Flood Fill Tool", "to-right", "vertical-center" ] }
      )
    }

  }

  //the paint tool options
  {
    console.error( "UI.updateContext() needs to rebuild list of hidden elements, not check every mouse move." );
    const paintToolsOptionsRow = document.createElement( "div" );
    paintToolsOptionsRow.classList.add( "flex-row", "hidden", "animated" );
    paintToolsOptionsRow.id = "paint-tools-options-row";
    uiContainer.appendChild( paintToolsOptionsRow );
    UI.registerElement(
      paintToolsOptionsRow,
      {
        updateContext: () => {
          if( uiSettings.activeTool === "paint" ) {
            paintToolsOptionsRow.classList.remove( "hidden" );
            const colorWell = document.querySelector( ".paint-tools-options-color-well" );
            colorWell.classList.remove( "hidden" );
            paintToolsOptionsRow.appendChild( colorWell );
          }
          else if( uiSettings.activeTool === "mask" ) {
            paintToolsOptionsRow.classList.remove( "hidden" );
            const colorWell = document.querySelector( ".paint-tools-options-color-well" );
            colorWell.classList.add( "hidden" );
            paintToolsOptionsRow.appendChild( colorWell );
          }
          else {
            paintToolsOptionsRow.classList.add( "hidden" );
          }
        }
      },
      {
        zIndex: 1000,
      }
    );

    //the brush select (asset browser) button
    {
      const brushSelectBrowseButton = document.createElement( "div" );
      //brushSelectBrowseButton.classList.add( "asset-browser-button" );
      brushSelectBrowseButton.classList.add( "asset-button", "round-toggle", "on", "unimplemented" );
      UI.registerElement(
        brushSelectBrowseButton,
        { onclick: () => console.log( "Open brush asset browser" ) },
        { tooltip: [ "!unimplemented! Select Brush", "below", "to-right-of-center" ], zIndex:10000, }
      );
      paintToolsOptionsRow.appendChild( brushSelectBrowseButton );
    }
  
    //the paint button
    {
      const paintModeButton = document.createElement( "div" );
      //brushSelectBrowseButton.classList.add( "asset-browser-button" );
      paintModeButton.classList.add( "paint-tools-options-paint-mode", "round-toggle", "on" );
      UI.registerElement(
        paintModeButton,
        {
          ondrag: () => uiSettings.toolsSettings.paint.setMode( "brush" ),
          updateContext: () => {
            if( uiSettings.toolsSettings.paint.mode === "brush" ) paintModeButton.classList.add( "on" );
            else paintModeButton.classList.remove( "on" );
          }
        },
        { tooltip: [ "Paint Mode", "below", "to-right-of-center" ], zIndex:10000, }
      );
      paintToolsOptionsRow.appendChild( paintModeButton );
    }
    //the blend button
    {
      const blendMode = document.createElement( "div" );
      //brushSelectBrowseButton.classList.add( "asset-browser-button" );
      blendMode.classList.add( "paint-tools-options-blend-mode", "round-toggle", "on" );
      UI.registerElement(
        blendMode,
        {
          ondrag: () => uiSettings.toolsSettings.paint.setMode( "blend" ),
          updateContext: () => {
            if( uiSettings.toolsSettings.paint.mode === "blend" ) blendMode.classList.add( "on" );
            else blendMode.classList.remove( "on" );
          }
        },
        { tooltip: [ "Blend Mode", "below", "to-right-of-center" ], zIndex:10000, }
      );
      paintToolsOptionsRow.appendChild( blendMode );
    }
    //the erase button
    {
      const eraseMode = document.createElement( "div" );
      //brushSelectBrowseButton.classList.add( "asset-browser-button" );
      eraseMode.classList.add( "paint-tools-options-erase-mode", "round-toggle", "on" );
      UI.registerElement(
        eraseMode,
        {
          ondrag: () => uiSettings.toolsSettings.paint.setMode( "erase" ),
          updateContext: () => {
            if( uiSettings.toolsSettings.paint.mode === "erase" ) eraseMode.classList.add( "on" );
            else eraseMode.classList.remove( "on" );
          }
        },
        { tooltip: [ "Erase Mode", "below", "to-right-of-center" ], zIndex:10000, }
      );
      paintToolsOptionsRow.appendChild( eraseMode );
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
        { tooltip: [ '<img src="icon/arrow-left.png"> Drag to Adjust Brush Size <img src="icon/arrow-right.png">', "below", "to-right-of-center" ], zIndex:10000, }
      );
      paintToolsOptionsRow.appendChild( retractableSizeSlider );
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
      paintToolsOptionsRow.appendChild( retractableSoftnessSlider );
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
      paintToolsOptionsRow.appendChild( retractableOpacitySlider );
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
          }
        },
        {
          tooltip: [ "Change Color", "below", "to-left-of-center" ], zIndex:10000,
        }
      );
      paintToolsOptionsRow.appendChild( colorWell );
    }
  }

  //the transform tool options
  {
    
    const transformToolOptionsRow = document.createElement( "div" );
    transformToolOptionsRow.classList.add( "flex-row", "hidden", "animated" );
    transformToolOptionsRow.id = "transform-tools-options-row";
    uiContainer.appendChild( transformToolOptionsRow );
    UI.registerElement(
      transformToolOptionsRow,
      {
        updateContext: () => {
          if( uiSettings.activeTool === "transform" ) {
            transformToolOptionsRow.classList.remove( "hidden" );
          }
          else {
            transformToolOptionsRow.classList.add( "hidden" );
          }
        }
      },
      {
        zIndex: 1000,
      }
    );


    //the width slider
    if( false ) {
      const layerWidthSlider = document.createElement( "div" );
      layerWidthSlider.classList.add( "generative-controls-retractable-slider", "animated" );
      const widthLabel = document.createElement( "div" );
      widthLabel.classList.add( "control-element-label" );
      layerWidthSlider.appendChild( widthLabel );
      const leftArrow = layerWidthSlider.appendChild( document.createElement( "div" ) );
      leftArrow.classList.add( "generative-controls-retractable-slider-left-arrow" );
      const numberPreview = layerWidthSlider.appendChild( document.createElement( "div" ) );
      numberPreview.classList.add( "generative-controls-retractable-slider-number-preview" );
      numberPreview.textContent = 0;
      const rightArrow = layerWidthSlider.appendChild( document.createElement( "div" ) );
      rightArrow.classList.add( "generative-controls-retractable-slider-right-arrow" );
      let min = 1,
        //max = 2**14,
        max = 2048,
        step=1;
      let startingNumber,
        adjustmentScale;
      UI.registerElement(
        layerWidthSlider,
        {
          ondrag: ({ rect, start, current, ending, starting, element }) => {
            if( starting ) {
              layerWidthSlider.querySelector( ".tooltip" ).style.opacity = 0;
              startingNumber = selectedLayer.w;
              adjustmentScale = 1/ 3; //3 pixels to 1 pixel
            }
            const dx =  current.x - start.x;
            const adjustment = dx * adjustmentScale;
            let number = startingNumber + adjustment;
            number = Math.max( min, Math.min( max, number ) );
            number = parseInt( number / step ) * step;
            
            //setLayerSize( selectedLayer, number, selectedLayer.height );

            numberPreview.textContent = number;
            if( ending ) {
              layerWidthSlider.querySelector( ".tooltip" ).style = "";
            }
          },
          //updateContext: () => {}
        },
        { tooltip: [ '<img src="icon/arrow-left.png"> Adjust Layer Width <img src="icon/arrow-right.png">', "below", "to-right-of-center" ], zIndex:10000, }
      );
      transformToolOptionsRow.appendChild( layerWidthSlider );
    }

  }

  //the flood fill tool options
  {
    const floodFillOptionsRow = document.createElement( "div" );
    floodFillOptionsRow.classList.add( "flex-row", "hidden", "animated" );
    floodFillOptionsRow.id = "paint-tools-options-row";
    uiContainer.appendChild( floodFillOptionsRow );
    UI.registerElement(
      floodFillOptionsRow,
      {
        updateContext: () => {
          if( uiSettings.activeTool === "flood-fill" ) {
            floodFillOptionsRow.classList.remove( "hidden" );
            const colorWell = document.querySelector( ".paint-tools-options-color-well" );
            colorWell.classList.remove( "hidden" );
            floodFillOptionsRow.appendChild( colorWell );
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

    //the colorwell is here, but it's swiped from the paint tools
    //need a toggle for fill vs. erase
    //need a toggle for area vs. color
    //need a slider for tolerance
    //need a slider for padding

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
          if( uiSettings.activeTool === "generate" ) generativeControlsRow.classList.remove( "hidden" );
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
              if( apiFlow.isDemo ) continue;
              if( apiFlow.apiFlowType === "asset" ) continue;
              const asset = { name: apiFlow.apiFlowName }
              assets.push( asset );
            }
            const callback = asset => {
              selectedLayer.generativeSettings.apiFlowName = asset.name;
              setupUIGenerativeControls( asset.name );
            }
            openAssetBrowser( assets, callback );
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
            const apiFlow = apiFlows.find( flow => flow.apiFlowName === apiFlowName );
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
                control.controlValue = controlSource.controlValue;
              }
              if( control.controlType === "image" ) {
                let sourceLayer;
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
                //cast source layer to generative layer's space
                const previewLayer = layersStack.layers.find( l => l.layerType === "paint-preview" );
                sampleLayerInLayer( sourceLayer, selectedLayer, previewLayer );
                const dataURL = previewLayer.canvas.toDataURL();
                //controlValues[ control.controlName ] = dataURL.substring( dataURL.indexOf( "," ) + 1 );
                controlValues[ control.controlName ] = dataURL;
                if( false ) {
                  const output = document.body.appendChild( document.createElement( "div" ) );
                  output.style = "position:absolute; left:0; top:0; color:red; border:1px solid red; width:25vw; height:25vh; font-size:4px; overflow-y:scroll; pointer-events:all; z-index:999999999";
                  output.textContent = controlValues[ control.controlName ];
                  //console.log( controlValues[ control.controlName ] );
                }
              }
            }

            //for any values not provided, executeAPICall will retain the default values encoded in those controls, including "static" controltypes

            //do the generation
            const result = await executeAPICall( apiFlowName, controlValues );
            //absolutely everywhere I reference CTX calls like this will need to change with GPU paint?
            //Or... Hmm. Maybe I use those pixelreads to update these canvases.
            //Well... I have to keep the canvases anyway, right??? For previews. So no change???
            const image = result[ "generated-image" ];
            if( image.width !== selectedLayer.w || image.height !== selectedLayer.h )
              resetLayerSize( selectedLayer, image.width, image.height );
            selectedLayer.context.drawImage( result[ "generated-image" ], 0, 0 );
            flagLayerTextureChanged( selectedLayer );
          }
        },
        { tooltip: [ "Generate", "below", "to-left-of-center" ], zIndex:10000, },
      )
      generativeControlsRow.appendChild( generateButton );
    }
    //the text-input overlay
    {
      //full-screen overlay
      const textInputOverlay = document.createElement( "div" );
      textInputOverlay.classList.add( "overlay-background", "hidden", "real-input", "animated" );
      textInputOverlay.id = "multiline-text-input-overlay";
      textInputOverlay.onapply = () => {};
      textInputOverlay.setText = text => { textInput.value = text };
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
      textInputOverlay.appendChild( closeButton );
      //text input
      const textInput = document.createElement( "textarea" );
      textInput.classList.add( "overlay-text-input", "overlay-element", "animated" );
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
      textInputOverlay.appendChild( applyButton );

      overlayContainer.appendChild( textInputOverlay );
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
      fullscreenButton.classList.add( "round-toggle", "on", "home-row-enter-fullscreen-button" );
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
            if( document.fullscreenElement ) fullscreenButton.classList.add( "fullscreen" );
            else fullscreenButton.classList.remove( "fullscreen" );
          },
        },
        { tooltip: [ "Enter/Exit Fullscreen", "below", "to-right-of-center" ] },
      )
    }
    //the save button
    {
      const saveButton = document.createElement( "div" );
      saveButton.classList.add( "round-toggle", "on", "home-row-save-button" );
      homeRow.appendChild( saveButton );
      UI.registerElement(
        saveButton,
        { onclick: () => saveJSON() },
        { tooltip: [ "Save Project", "below", "to-right-of-center" ] },
      )
    }
    //the load button
    {
      const loadButton = document.createElement( "div" );
      loadButton.classList.add( "round-toggle", "on", "home-row-load-button" );
      homeRow.appendChild( loadButton );
      UI.registerElement(
        loadButton,
        { onclick: () => loadJSON() },
        { tooltip: [ "Load Project", "below", "to-right-of-center" ] },
      )
    }
    //the export button
    {
      const exportButton = document.createElement( "div" );
      exportButton.classList.add( "round-toggle", "on", "home-row-export-button" );
      homeRow.appendChild( exportButton );
      UI.registerElement(
        exportButton,
        { onclick: () => exportPNG() },
        { tooltip: [ "Export as Image", "below", "to-right-of-center" ] },
      )
    }
  }


  //the console
  /* const consoleElement = uiContainer.appendChild( document.createElement( "div" ) );
  consoleElement.id = "console"; */

  //undo/redo
  {
    const undoRedoRow = document.createElement( "div" );
    undoRedoRow.classList.add( "flex-row" );
    undoRedoRow.id = "undo-redo-row";
    uiContainer.appendChild( undoRedoRow );
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
      undoRedoRow.appendChild( undoButton );
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
      undoRedoRow.appendChild( redoButton );
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

    {
      //the add layers hovering panel
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

      {
        //add the generative layer add button
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

      {
        //add the paint layer add button
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

      {
        //add add text layer button
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
            console.error( "Image import unimplemented." );
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

      {
        //add add pose layer button
        const addPoseLayerButton = addLayersPanel.appendChild( document.createElement( "div" ) );
        addPoseLayerButton.classList.add( "rounded-line-button", "animated", "unimplemented" );
        addPoseLayerButton.appendChild( new Image() ).src = "icon/rig.png";
        addPoseLayerButton.appendChild( document.createElement("span") ).textContent = "Add Pose Layer";
        UI.registerElement( addPoseLayerButton, {
          onclick: () => {
            addPoseLayerButton.classList.add( "pushed" );
            setTimeout( () => addPoseLayerButton.classList.remove( "pushed" ), UI.animationMS );
            //addCanvasLayer( "pose" );
            UI.deleteContext( "add-layers-panel-visible" );
            console.error( "Image import unimplemented." );
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

      {
        //add the import image button
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
              const imageLayer = await addCanvasLayer( "paint", img.width, img.height );
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
      } else {
        colorWheel.classList.add( "hidden" );
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
    {
      const assetBrowserTagsBar = document.createElement( "div" );
      assetBrowserTagsBar.id = "asset-browser-tags-bar";
      assetBrowserContainer.appendChild( assetBrowserTagsBar );
      const placeholder = document.createElement( "div" );
      placeholder.classList.add( "placeholder" );
      placeholder.textContent = "[No Tags Found]";
      assetBrowserTagsBar.appendChild( placeholder );
    }
    
    //search tags bar
    {
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

function openAssetBrowser( assets, callback ) {

  const assetBrowserContainer = document.querySelector( "#asset-browser-container" );
  const assetBrowserPreview = document.querySelector( "#asset-browser-preview" );

  //clear the assets list
  const list = document.querySelector( "#asset-browser-list" );
  list.innerHTML = "";
  
  //add the assets
  let activeAsset = null;
  for( const asset of assets ) {
    const assetElement = document.createElement( "div" );
    assetElement.textContent = asset.name;
    assetElement.classList.add( "asset-element" );
    assetElement.onclick = () => {
      document.querySelectorAll( ".asset-element" ).forEach( e => e.classList.remove( "active" ) );
      assetElement.classList.add( "active" );
      assetBrowserPreview.textContent = asset.name;
      activeAsset = asset;
    }
    list.appendChild( assetElement );
  }

  assetBrowserPreview.textContent = "";

  //activate the apply button
  const applyButton = document.querySelector( "#asset-browser-apply-button" );
  applyButton.onclick = () => {

    //just close if no asset picked
    if( activeAsset === null ) {
      enableKeyTrapping();
      assetBrowserContainer.classList.add( "hidden" );
      return;
    }

    applyButton.classList.add( "pushed" );
    setTimeout( ()=>applyButton.classList.remove("pushed"), UI.animationMS );
    enableKeyTrapping();
    assetBrowserContainer.classList.add( "hidden" );
    callback( activeAsset );
  }

  assetBrowserContainer.classList.remove( "hidden" );
  disableKeyTrapping();

}

function setupUIGenerativeControls( apiFlowName ) {

  if( ! setupUIGenerativeControls.init ) {
    setupUIGenerativeControls.registeredControls = [];
    setupUIGenerativeControls.currentApiFlowName = null;
    setupUIGenerativeControls.currentSelectedLayer = null;
    setupUIGenerativeControls.init = true;
  }

  selectedLayer.generativeControls[ apiFlowName ] ||= {};

  setupUIGenerativeControls.currentApiFlowName = apiFlowName;

  for( const oldControl of setupUIGenerativeControls.registeredControls ) {
    UI.unregisterElement( oldControl );
  }
  setupUIGenerativeControls.registeredControls.length = 0;


  const controlsPanel = document.querySelector( "#generative-controls-panel" );
  controlsPanel.innerHTML = "";
  controlsPanel.apiFlowName = apiFlowName;
  const imageInputsPanel = document.querySelector( "#generative-controls-images-inputs-panel");
  imageInputsPanel.innerHTML = "";

  let numberOfImageInputs = 0;

  const apiFlow = apiFlows.find( flow => flow.apiFlowName === apiFlowName );
  for( const control of apiFlow.controls ) {

    //load control from layer if any
    control.controlValue = selectedLayer.generativeControls[ apiFlowName ]?.[ control.controlName ] || control.controlValue;

    //store control value in selected layer
    selectedLayer.generativeControls[ apiFlowName ][ control.controlName ] = control.controlValue;

    //make the element from the type
    if( control.controlType === "asset" ) {
      const assetSelectorButton = document.createElement( "div" );
      assetSelectorButton.classList.add( "asset-button-text", "round-toggle", "long", "on" );
      const buttonText = document.createElement( "div" );
      buttonText.classList.add( "button-text" );
      buttonText.textContent = "↓ " + control.controlValue;
      assetSelectorButton.appendChild( buttonText );
      //check if we have this asset library
      if( ! assetsLibrary.hasOwnProperty( control.assetName ) ) {
        //download the asset if we can
        const assetAPI = apiFlows.find( a => ( (!a.isDemo) && a.apiFlowType === "asset" && a.assetLibraries.includes( control.assetName )) );
        if( assetAPI ) {
          if( apiExecutionQueue.find( q => q[ 0 ] === assetAPI.apiFlowName ) ) {
            //already scheduled, hopefully will resolve before this button is clicked
          } else {
            executeAPICall( assetAPI.apiFlowName, {} );
          }
        }
      }
      UI.registerElement(
        assetSelectorButton,
        {
          onclick: () => {
            const callback = asset => {
              buttonText.textContent = "↓ " + asset.name;
              control.controlValue = asset.name;
              selectedLayer.generativeControls[ apiFlowName ][ control.controlName ] = control.controlValue;
            }
            //console.log( "Opening assets: ", control.assetName, assetsLibrary[ control.assetName ] )
            openAssetBrowser( assetsLibrary[ control.assetName ] || [], callback );
          }
        },
        { tooltip: [ "Select " + control.assetName, "below", "to-right-of-center" ], zIndex:10000, },
      )
      controlsPanel.appendChild( assetSelectorButton );
    }
    if( control.controlType === "text" ) {
      const controlElement = document.createElement( "div" );
      controlElement.classList.add( "text-input-control", "animated" );
      controlElement.controlName = control.controlName;
      const controlElementText = document.createElement( "div" );
      controlElementText.classList.add( "text-input-control-text" );
      controlElementText.textContent = control.controlValue;
      controlElement.appendChild( controlElementText );
      const controlElementLabel = document.createElement( "div" );
      controlElementLabel.classList.add( "control-element-label" );
      controlElementLabel.textContent = control.controlName;
      controlElement.appendChild( controlElementLabel );
      setupUIGenerativeControls.registeredControls.push( controlElement );
      UI.registerElement(
        controlElement,
        {
          onclick: () => {
            const textInput = document.querySelector( "#multiline-text-input-overlay" );
            textInput.setText( control.controlValue );
            textInput.onapply = text => {
              controlElementText.textContent = text;
              control.controlValue = text;
              //store updated value in selected layer
              selectedLayer.generativeControls[ apiFlowName ][ control.controlName ] = control.controlValue;
            }
            textInput.show();
          } 
        },
        { tooltip: [ control.controlName, "below", "to-right-of-center" ], zIndex:10000, }
      );
      controlsPanel.appendChild( controlElement );
    }
    if( control.controlType === "number" ) {
      const controlElement = document.createElement( "div" );
      controlElement.classList.add( "generative-controls-retractable-slider", "animated" );
      controlElement.controlName = control.controlName;
      const controlElementLabel = document.createElement( "div" );
      controlElementLabel.classList.add( "control-element-label" );
      controlElementLabel.textContent = control.controlName;
      controlElement.appendChild( controlElementLabel );
      const leftArrow = controlElement.appendChild( document.createElement( "div" ) );
      leftArrow.classList.add( "generative-controls-retractable-slider-left-arrow" );
      const numberPreview = controlElement.appendChild( document.createElement( "div" ) );
      numberPreview.classList.add( "generative-controls-retractable-slider-number-preview" );
      numberPreview.textContent = control.controlValue;
      const rightArrow = controlElement.appendChild( document.createElement( "div" ) );
      rightArrow.classList.add( "generative-controls-retractable-slider-right-arrow" );
      let startingNumber,
        adjustmentScale;
      UI.registerElement(
        controlElement,
        {
          ondrag: ({ rect, start, current, ending, starting, element }) => {
            if( starting ) {
              controlElement.querySelector( ".tooltip" ).style.opacity = 0;
              startingNumber = control.controlValue;
              adjustmentScale = ( control.max - control.min ) / 300; //300 pixel screen-traverse
            }
            const dx =  current.x - start.x;
            const adjustment = dx * adjustmentScale;
            let number = startingNumber + adjustment;
            number = Math.max( control.min, Math.min( control.max, number ) );
            number = parseInt( number / control.step ) * control.step;
            control.controlValue = number;
            //store updated value in selected layer
            selectedLayer.generativeControls[ apiFlowName ][ control.controlName ] = control.controlValue;
            const trimLength = control.step.toString().indexOf( "." ) + 1;
            numberPreview.textContent = trimLength ? number.toString().substring( 0, trimLength+2 ) : number;
            if( ending ) {
              controlElement.querySelector( ".tooltip" ).style = "";
            }
          },
          //updateContext: () => {}
        },
        { tooltip: [ '<img src="icon/arrow-left.png"> Adjust ' + control.controlName + ' <img src="icon/arrow-right.png">', "below", "to-right-of-center" ], zIndex:10000, }
      );
      controlsPanel.appendChild( controlElement );
    }
    if( control.controlType === "asset" ) {}
    if( control.controlType === "layer-input" ) {}
    if( control.controlType === "image" ) {
      const controlElement = document.createElement( "div" );
      controlElement.classList.add( "image-input-control", "animated" );

      const controlElementLabel = document.createElement( "div" );
      controlElementLabel.classList.add( "image-control-element-label" );
      controlElementLabel.textContent = control.controlHint.substring( 0, 5 ); //max 5 hint characters
      controlElement.appendChild( controlElementLabel );

      controlElement.controlName = control.controlName;
      controlElement.uplinkLayer = null;

      //look for a linked input (the link HTML element is created on UI update context)
      searchForLinkLayer:
      for( const uplinkLayer of layersStack.layers ) {
        for( const uplink of uplinkLayer.nodeUplinks ) {
          if( uplink.layerId === selectedLayer.layerId && uplink.apiFlowName === apiFlowName && uplink.controlName === control.controlName ) {
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
              if( uplink.layerId === selectedLayer.layerId && uplink.apiFlowName === apiFlowName && uplink.controlName === control.controlName ) {
                controlElement.uplinkLayer.nodeUplinks.delete( uplink );
                break;
              }
            }
            controlElement.uplinkLayer = null;
            UI.updateContext();
          }
        } },
        { tooltip: [ control.controlName, "below", "to-left-of-center" ], zIndex:10000, }
      );
      imageInputsPanel.appendChild( controlElement );
      numberOfImageInputs += 1;
    }
  }

  const imageInputsWidth = 0.5 + numberOfImageInputs * 1.5;

  imageInputsPanel.style.width = imageInputsWidth + "rem";
  controlsPanel.style.width = `calc( 100% - ( 12.4rem + ${imageInputsWidth}rem ) )`;

  UI.updateContext();

}

const keys = {}
function enableKeyTrapping() {
  window.addEventListener( "keydown" , keyDownHandler );
  window.addEventListener( "keyup" , keyUpHandler );
}
function disableKeyTrapping() {
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

    if( e.key === "ArrowRight" && selectedLayer ) {
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
    }

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
  let previewLayer;
  for( const l of layersStack.layers ) {
    if( l.layerType === "paint-preview" ) {
      previewLayer = l;
      break;
    }
  }
  const ctx = previewLayer.context;
  const {w,h} = previewLayer;
  ctx.clearRect( 0, 0, w, h );

  const layersToDraw = [];
  for( const layer of layersStack.layers ) {
    if( layer.layerType === "paint-preview" ) continue;
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

  composeLayers( previewLayer, layersToDraw, pixelScale );

  /* const maskingCanvas = layersStack.layers[ 0 ].maskContext,
    maskingContext = layersStack.layers[ 0 ].maskContext;
  for( let i=1; i<layersStack.layers.length; i++ ) {
    const layer = layersStack.layers[i];
    if( layer.visible && layer.opacity > 0 ) {
      //TODO: orient the layer with its coordinates relative to the export bounding box. Have code elsewhere if I didn't delete it.
      if( layer.maskInitialized === false ) {
        ctx.drawImage( layer.canvas, 0, 0 );
      }
      else if( layer.maskInitialized === true ) {
        maskingContext.save();
        maskingContext.globalCompositeOperation = "copy";
        maskingContext.drawImage( layer.maskCanvas, 0, 0 );
        maskingContext.globalCompositeOperation = "source-in";
        maskingContext.drawImage( layer.canvas, 0, 0 );
        maskingContext.restore();
        ctx.drawImage( maskingCanvas, 0, 0 );
      }
    }
  } */

  const imgURL = layersStack.layers[0].canvas.toDataURL();
  
  const a = document.createElement( "a" );
  a.download = "Untitled AI Paint App POC - export - " + Date.now() + ".png";
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
    else if( Array.isArray( sourceObject[ key ] ) ) {
      cloneTarget[ key ] ||= new Array( sourceObject[ key ].length );
      cloneObjectForJSON( sourceObject[ key ], cloneTarget[ key ], ignorePath, path.concat( key ) );
    }
    else if( valueType === "object" ) {
      cloneTarget[ key ] ||= {};
      cloneObjectForJSON( sourceObject[ key ], cloneTarget[ key ], ignorePath, path.concat( key ) );
    }
  }
}

function saveJSON() {
  let settingsClone = {};
  const brushTipImages = uiSettings.toolsSettings.paint.modeSettings.all.brushTipsImages;
  delete uiSettings.toolsSettings.paint.modeSettings.all.brushTipsImages;
  cloneObjectForJSON( uiSettings, settingsClone, nonSavedSettingsPaths );
  uiSettings.toolsSettings.paint.modeSettings.all.brushTipsImages = brushTipImages;
  console.log( settingsClone );
  const uiSettingsSave = JSON.parse( JSON.stringify( settingsClone ) );
  const layersSave = [];
  for( const layer of layersStack.layers ) {
    if( layer.layerType === "paint-preview" ) continue;
    //drop the canvas, context, glTexture... linkNodes??? ...Yeah. Those don't save right now.
    const {
      layerType,
      layerName,
      layerId,
      layerGroupId,
      groupClosed,

      visible,
      opacity,

      generativeSettings,
      nodeUplinks,
      generativeControls,

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

      generativeSettings,
      nodeUplinks: [ ...nodeUplinks ],
      generativeControls,
      
      w, h,
      topLeft, topRight, bottomLeft, bottomRight,
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
  a.download = "Untitled AI Paint App POC - save - " + Date.now() + ".json";
  const b = new Blob( [saveFileString], { type: "application/json" } );
  a.href = URL.createObjectURL( b );
  document.body.appendChild( a );
  a.click();
  document.body.removeChild( a );
  URL.revokeObjectURL( b );

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
  console.error( "Need to lock UI for async file load." );

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
      
        //if we opened over an existing file, we have to clear everything up
        for( const layer of layersStack.layers ) {
          if( layer.layerType === "paint-preview" ) continue;
          deleteLayer( layer );
        }
        clearUndoHistory();
        
        let lastLayer;
        for( const layer of layersSave ) {
          let newLayer = await addCanvasLayer( layer.layerType, layer.w, layer.h, lastLayer );
          lastLayer = newLayer;
          console.log( "Got new layer: ", newLayer );
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
      
            generativeSettings,
            nodeUplinks,
            generativeControls,
            
            w, h,
            topLeft, topRight, bottomLeft, bottomRight,
          } = layer;

          newLayer.layerType = layerType;
          newLayer.layerName = layerName;
          newLayer.layerId = layerId;
          layersAddedCount = Math.max( layersAddedCount, layerId )
          newLayer.layerGroupId = layerGroupId;
          newLayer.groupCompositeUpToDate = false;
          newLayer.groupClosed = groupClosed;

          newLayer.visible = visible;
          newLayer.opacity = opacity;

          newLayer.generativeSettings = generativeSettings;
          newLayer.nodeUplinks = new Set( nodeUplinks );
          newLayer.generativeControls = generativeControls;

          newLayer.w = w;
          newLayer.h = h;
          newLayer.topLeft = topLeft;
          newLayer.topRight = topRight;
          newLayer.bottomLeft = bottomLeft;
          newLayer.bottomRight = bottomRight;

          newLayer.textureChanged = false;
          //initialized to full panel, leave
          //newLayer.textureChangedRect = textureChangedRect;
        }

        //update the brush color preview
        {
          const { h,s,l } = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl;
          document.querySelector( ".paint-tools-options-color-well" ).style.backgroundColor = `hsl( ${h}turn ${s*100}% ${l*100}% )`;
        }

        //clear undo again so we can't one-by-one remove our loaded layers
        clearUndoHistory();

        reorganizeLayerButtons();

        UI.updateContext();

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
  updateContext: () => {
    for( const [,events] of UI.elements ) {
      events.updateContext?.( UI.context );
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

    for( const [element] of UI.elements ) {

      if( element.classList.contains( "no-hover" ) ||
        element.classList.contains( "hidden" ) ||
        element.parentElement?.classList.contains( "hidden" ) ||
        element.parentElement?.parentElement?.classList.contains( "hidden" ) ||
        element.parentElement?.parentElement?.parentElement?.classList.contains( "hidden" ) ) continue;

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
    for( const [element] of UI.elements )
      element.classList.remove( "hovering" );
  },

  testElements: p => {

    const x = p.clientX, y = p.clientY;
    const reverseElements = [ ...UI.elements ].reverse();
    reverseElements.sort( (a,b) => (( b[0].zIndex - a[0].zIndex ) || ( b[0].insertOrder - a[0].insertOrder )) );
    for( const [element,events] of reverseElements ) {

      if( ! element.uiActive ) continue;
      if( element.classList.contains( "hidden" ) ||
        element.parentElement?.classList.contains( "hidden" ) ||
        element.parentElement?.parentElement?.classList.contains( "hidden" ) ||
        element.parentElement?.parentElement?.parentElement?.classList.contains( "hidden" ) ) continue;

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

/* function testUIElements( p ) {
  const x = p.clientX, y = p.clientY;
  const reverseElements = [ ...uiElements ].reverse();
  for( const [element,events] of reverseElements ) {
    if( ! element.uiActive ) continue;
    const r = element.getClientRects()[0];
    if( ! r ) continue; //element is invisible or off-screen
    if( x < r.left || x > r.right || y < r.top || y > r.bottom )
      continue;
    if( events.onclick ) {
      let inrange = true;
      uiHandlers[ p.pointerId ] = {
        move: p => {
          const x = p.clientX, y = p.clientY;
          inrange = ! ( x < r.left || x > r.right || y < r.top || y > r.bottom );
        },
        end: p => {
          if( inrange ) events.onclick();
          delete uiHandlers[ p.pointerId ];
        }
      }
    }
    if( events.ondrag ) {
      const rect = r,
        start = {x,y},
        current = {x,y};
      uiHandlers[ p.pointerId ] = {
        move: ( p, starting = false ) => {
          current.x = p.clientX; current.y = p.clientY;
          events.ondrag({ rect, start, current, ending: false, starting, element });
        },
        end: p => {
          current.x = p.clientX; current.y = p.clientY;
          events.ondrag({ rect, start, current, ending: true, starting: false, element });
          delete uiHandlers[ p.pointerId ];
        }
      }
      uiHandlers[ p.pointerId ].move( p, true );
    }
    return true;
  }
  return false;
} */

let info = "";

const contextMenuHandler = p => {
  //info += "C";
  cancelEvent( p );
}
const startHandler = p => {

    cancelEvent( p );

    if( p.pressure > 0 ) {
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

        if( keys[ " " ] === true ) {
            cursor.origin.x = x;
            cursor.origin.y = y;
            cursor.current.x = x;
            cursor.current.y = y;
            if( p.buttons === 1 ) cursor.mode = "pan";
            if( p.buttons === 2 ) {
                //must have offset for rotate (0-angle) to prevent shuddering (insta-moving to extreme angle with tiny mouse movement)
                cursor.origin.y -= cursor.zoomLength;
                cursor.mode = "rotate";
            }
            if( p.buttons === 4 ) {
                //must have offset for zoom (cannot start on zero-length reference basis)
                cursor.origin.x -= Math.cos(0.7855) * cursor.zoomLength;
                cursor.origin.y -= Math.sin( 0.7855 ) * cursor.zoomLength;
                cursor.mode = "zoom";
            }
            //check if one of our points is inside the selected layer, and disable transform if not
            if( uiSettings.activeTool === "transform" ) {
              const point = [cursor.origin.x,cursor.origin.y,1];
              let pointInSelectedLayer = testPointsInLayer( selectedLayer, [point], true );
              /* let pointInSelectedLayer = false;
              //get screen->global space inversion
              _originMatrix[ 2 ] = -view.origin.x;
              _originMatrix[ 5 ] = -view.origin.y;
              _positionMatrix[ 2 ] = view.origin.x;
              _positionMatrix[ 5 ] = view.origin.y;
    
              mul3x3( viewMatrices.current , _originMatrix , _inverter );
              mul3x3( _inverter , viewMatrices.moving , _inverter );
              mul3x3( _inverter , _positionMatrix , _inverter );
              inv( _inverter , _inverter );
    
              //cast our input points to global space
              mul3x1( _inverter, point, point );
    
              //get our selected layer's space
              let origin = { x:selectedLayer.topLeft[0], y:selectedLayer.topLeft[1] },
                xLeg = { x:selectedLayer.topRight[0] - origin.x, y: selectedLayer.topRight[1] - origin.y },
                xLegLength = Math.sqrt( xLeg.x**2 + xLeg.y**2 ),
                normalizedXLeg = { x:xLeg.x/xLegLength, y:xLeg.y/xLegLength },
                yLeg = { x:selectedLayer.bottomLeft[0] - origin.x, y: selectedLayer.bottomLeft[1] - origin.y },
                yLegLength = Math.sqrt( yLeg.x**2 + yLeg.y**2 ),
                normalizedYLeg = { x:yLeg.x/yLegLength, y:yLeg.y/yLegLength };
    
              //cast global point to our selected layer's space
              {
                let [x,y] = point;
                //translate from origin
                x -= origin.x; y -= origin.y;
                //project on normals
                let xProjection = x*normalizedXLeg.x + y*normalizedXLeg.y;
                let yProjection = x*normalizedYLeg.x + y*normalizedYLeg.y;
                //unnormalize
                xProjection *= selectedLayer.w / xLegLength;
                yProjection *= selectedLayer.h / yLegLength;
                //check if the point is inside the layer bounds
                if( x >= 0 && x <= selectedLayer.w && y >= 0 && y <= selectedLayer.h ) {
                  pointInSelectedLayer = true;
                }
              } */
    
              if( pointInSelectedLayer ) {
                uiSettings.toolsSettings.transform.current = true;
                uiSettings.toolsSettings.transform.transformingLayers.length = 0;
                if( selectedLayer.layerType === "group" ) {
                  const groupChildren = collectGroupedLayersAsFlatList( selectedLayer.layerId );
                  const transformableChildren = [];
                  for( const layer of groupChildren ) {
                    if( layer.layerType === "group" ) continue;
                    transformableChildren.push( layer );
                  }
                  uiSettings.toolsSettings.transform.transformingLayers.push( ...transformableChildren );
                }
                else {
                  uiSettings.toolsSettings.transform.transformingLayers.push( selectedLayer );
                }
              }
              else {
                uiSettings.toolsSettings.transform.current = false;
                uiSettings.toolsSettings.transform.transformingLayers.length = 0;
              }
            }
        }
        else if( p.pointerType !== "touch" && selectedLayer &&
          ( uiSettings.activeTool === "paint" || uiSettings.activeTool === "mask" ) ) {
          beginPaint();
        }
    }
    else {
        cursor.mode = "none";
        cursor.origin.x = 0;
        cursor.origin.y = 0;
        cursor.current.x = 0;
        cursor.current.y = 0;
    }
    if( pointers.count === 2 && selectedLayer && getLayerVisibility( selectedLayer )  ) {


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
          let pointInSelectedLayer = testPointsInLayer( selectedLayer, points, true );
          /* let pointInSelectedLayer = false;
          //get screen->global space inversion
          _originMatrix[ 2 ] = -view.origin.x;
          _originMatrix[ 5 ] = -view.origin.y;
          _positionMatrix[ 2 ] = view.origin.x;
          _positionMatrix[ 5 ] = view.origin.y;

          mul3x3( viewMatrices.current , _originMatrix , _inverter );
          mul3x3( _inverter , viewMatrices.moving , _inverter );
          mul3x3( _inverter , _positionMatrix , _inverter );
          inv( _inverter , _inverter );

          //cast our input points to global space
          mul3x1( _inverter, points[0], points[0] );
          mul3x1( _inverter, points[1], points[1] );

          //get our selected layer's space
          let origin = { x:selectedLayer.topLeft[0], y:selectedLayer.topLeft[1] },
            xLeg = { x:selectedLayer.topRight[0] - origin.x, y: selectedLayer.topRight[1] - origin.y },
            xLegLength = Math.sqrt( xLeg.x**2 + xLeg.y**2 ),
            normalizedXLeg = { x:xLeg.x/xLegLength, y:xLeg.y/xLegLength },
            yLeg = { x:selectedLayer.bottomLeft[0] - origin.x, y: selectedLayer.bottomLeft[1] - origin.y },
            yLegLength = Math.sqrt( yLeg.x**2 + yLeg.y**2 ),
            normalizedYLeg = { x:yLeg.x/yLegLength, y:yLeg.y/yLegLength };

          //cast global points to our selected layer's space
          for( const point of points ) {
            let [x,y] = point;
            //translate from origin
            x -= origin.x; y -= origin.y;
            //project on normals
            let xProjection = x*normalizedXLeg.x + y*normalizedXLeg.y;
            let yProjection = x*normalizedYLeg.x + y*normalizedYLeg.y;
            //unnormalize
            xProjection *= selectedLayer.w / xLegLength;
            yProjection *= selectedLayer.h / yLegLength;
            //check if the point is inside the layer bounds
            if( x >= 0 && x <= selectedLayer.w && y >= 0 && y <= selectedLayer.h ) {
              pointInSelectedLayer = true;
              break;
            }
          } */

          if( pointInSelectedLayer ) {
            uiSettings.toolsSettings.transform.current = true;
            uiSettings.toolsSettings.transform.transformingLayers.length = 0;
            if( selectedLayer.layerType === "group" ) {
              const groupChildren = collectGroupedLayersAsFlatList( selectedLayer.layerId );
              const transformableChildren = [];
              for( const layer of groupChildren ) {
                if( layer.layerType === "group" ) continue;
                transformableChildren.push( layer );
              }
              uiSettings.toolsSettings.transform.transformingLayers.push( ...transformableChildren );
            }
            else {
              uiSettings.toolsSettings.transform.transformingLayers.push( selectedLayer );
            }
          }
          else {
            uiSettings.toolsSettings.transform.current = false;
            uiSettings.toolsSettings.transform.transformingLayers.length = 0;
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
            const point = [ x , y , 1, p.pressure, p.altitudeAngle || 1.5707963267948966, p.azimuthAngle || 0 ];
            
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
            applyPaintStroke( painter.queue, layersStack.layers[0] );
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
        if( uiSettings.activeTool === "flood-fill" && painter.active === false && cursor.mode === "none" && selectedLayer?.layerType === "paint" ) {
          //get our global coordinate
          
          const point = [ cursor.current.x , cursor.current.y, 1 ];
          
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
          let origin = { x:selectedLayer.topLeft[0], y:selectedLayer.topLeft[1] },
            xLeg = { x:selectedLayer.topRight[0] - origin.x, y: selectedLayer.topRight[1] - origin.y },
            xLegLength = Math.sqrt( xLeg.x**2 + xLeg.y**2 ),
            normalizedXLeg = { x:xLeg.x/xLegLength, y:xLeg.y/xLegLength },
            yLeg = { x:selectedLayer.bottomLeft[0] - origin.x, y: selectedLayer.bottomLeft[1] - origin.y },
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
            xProjection *= selectedLayer.w / xLegLength;
            yProjection *= selectedLayer.h / yLegLength;
            layerX = parseInt( xProjection );
            layerY = parseInt( yProjection );
          }

          if( layerX >= 0 && layerY >= 0 && layerX <= selectedLayer.w && layerY <= selectedLayer.h )
            floodFillLayer( selectedLayer, layerX, layerY );
          
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
            painter.active = false;
            finalizePaint( layersStack.layers[ 0 ], selectedLayer );
            painter.queue.length = 0;
        }
    }
    if( pointers.count === 2 && selectedLayer && getLayerVisibility( selectedLayer )  ) {
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
    zoom: 1,
    pan: { x: 0, y: 0 },
    origin: { x: 0 , y: 0 }
}
const layerTransform = {
  angle: 0,
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
      }
  
      if( cursor.mode === "zoom" ) {
        //need initial offset for zoom
        layerTransform.origin.x = cursor.origin.x;
        layerTransform.origin.y = cursor.origin.y;
  
        const dx = cursor.current.x - cursor.origin.x;
        const dy = cursor.current.y - cursor.origin.y;
        const d = Math.sqrt( dx**2 + dy**2 );
        layerTransform.zoom = d / cursor.zoomLength;
        mat( layerTransform.zoom , 0 , 0 , 0 , layerTransformMatrices.moving );
      }
  
      if( cursor.mode === "rotate" ) {
        //need initial offset of 0-angle to prevent rotate shuddering
        layerTransform.origin.x = cursor.origin.x;
        layerTransform.origin.y = cursor.origin.y;
        
        const dx = cursor.current.x - cursor.origin.x;
        const dy = cursor.current.y - cursor.origin.y;
  
        layerTransform.angle = -Math.atan2( dx , dy );
        mat( 1 , layerTransform.angle , 0 , 0 , layerTransformMatrices.moving );
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
      }
  
      if( cursor.mode === "zoom" ) {
        //need initial offset for zoom
        view.origin.x = cursor.origin.x;
        view.origin.y = cursor.origin.y;
  
        const dx = cursor.current.x - cursor.origin.x;
        const dy = cursor.current.y - cursor.origin.y;
        const d = Math.sqrt( dx**2 + dy**2 );
        view.zoom = d / cursor.zoomLength;
        mat( view.zoom , 0 , 0 , 0 , viewMatrices.moving );
      }
  
      if( cursor.mode === "rotate" ) {
        //need initial offset of 0-angle to prevent rotate shuddering
        view.origin.x = cursor.origin.x;
        view.origin.y = cursor.origin.y;
        
        const dx = cursor.current.x - cursor.origin.x;
        const dy = cursor.current.y - cursor.origin.y;
  
        view.angle = -Math.atan2( dx , dy );
        mat( 1 , view.angle , 0 , 0 , viewMatrices.moving );
      }
    }
  }
  if( pointers.count === 2 && selectedLayer && getLayerVisibility( selectedLayer ) ) {
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
      layerTransform.angle = angle - pincher.origin.angle;
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
      view.angle = angle - pincher.origin.angle;
      view.pan.x = cx - pincher.origin.center.x;
      view.pan.y = cy - pincher.origin.center.y;
      mat( view.zoom , view.angle , view.pan.x , view.pan.y , viewMatrices.moving );
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

const paintGPUResources = {

  brushTipTexture: null,
  renderTexture: null,
  framebuffer: null,

  program: null,
  vertices: null,
  vertexBuffer: null,

  paintColorIndex: null,
  alphaIndex: null,
  brushTipIndex: null,
  blendSourceIndex: null,

  modRect: {x:0,y:0,x2:0,y2:0,w:0,h:0},
  //firstPaint: false,
  blendDistanceTraveled: 0,
  brushDistanceTraveled: 0,

  ready: false,
}
function setupPaintGPU() {
  //set up our shaders and renderbuffer
  //push some code to the GPU
  const vertexShaderSource = `#version 300 es
    in vec4 xyuv;

    out vec2 brushTipUV;
    out vec2 blendUV;
    
    void main() {
      brushTipUV = xyuv.zw;
      blendUV = xyuv.xy;
      gl_Position = vec4(xyuv.xy,0.5,1);
    }`;
  //gl_FragCoord: Represents the current fragment's window-relative coordinates and depth
  //gl_FrontFacing: Indicates if the fragment belongs to a front-facing geometric primitive
  //gl_PointCoord: Specifies the fragment's position within a point in the range 0.0 to 1.0
  //gl_FragColor: Represents the color of the fragment and is used to change the fragment's color
  const fragmentShaderSource = `#version 300 es
    precision highp float;

    uniform vec3 paintColor;
    uniform float alpha;
    
    uniform sampler2D brushTip;
    uniform sampler2D blendSource;

    in vec2 brushTipUV;
    in vec2 blendUV;

    out vec4 outColor;
    
    void main() {

      vec4 brushTipLookup = texture(brushTip,brushTipUV);
      vec4 blendLookup = texture(blendSource,blendUV);

      if( brushTipLookup.a === 0 ) {
        discard;
      }

      outColor = vec4( paintColor, alpha );
      
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
    paintGPUResources.program = program;

    console.log(gl.getProgramInfoLog(program));

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
    paintGPUResources.xyuvInputIndex = xyuvInputIndex;
    paintGPUResources.vertexBuffer = xyBuffer;
    paintGPUResources.vertices = xyuvs;
    gl.bindBuffer(gl.ARRAY_BUFFER,paintGPUResources.vertexBuffer);
    gl.bufferData( gl.ARRAY_BUFFER, new Float32Array(paintGPUResources.vertices), gl.STREAM_DRAW );

    paintGPUResources.paintColorIndex = gl.getUniformLocation( program, "paintColor" );
    paintGPUResources.alphaIndex = gl.getUniformLocation( program, "alpha" );
    paintGPUResources.brushTipIndex = gl.getUniformLocation( glState.program, "brushTip" );
    paintGPUResources.blendSourceIndex = gl.getUniformLocation( glState.program, "blendSource" );

    //set up a data-descriptor
    const vao = gl.createVertexArray();
    paintGPUResources.vao = vao;
    gl.bindVertexArray(paintGPUResources.vao);

    //push a description of our vertex data's structure
    gl.enableVertexAttribArray( paintGPUResources.xyuvInputIndex );
    {
      const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
      gl.vertexAttribPointer( paintGPUResources.xyuvInputIndex, size, dType, normalize, stride, offset );
    }

    paintGPUResources.brushTipTexture = gl.createTexture();

    paintGPUResources.renderTexture = gl.createTexture();

    const framebuffer = gl.createFramebuffer();
    paintGPUResources.framebuffer = framebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, paintGPUResources.framebuffer);
     
    // attach the texture as the first color attachment
    const attachmentPoint = gl.COLOR_ATTACHMENT0;
    const level = 0;
    gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, paintGPUResources.renderTexture, level);

}
function beginPaintGPU() {
  //set up GL textures and zero our distances traveled
  //set up the framebuffer/renderbuffer's size to match our destination canvas

  //if we're painting, blending, or erasing;
  //  always copy our source to our preview (and hide our source in loop draw)

  const layer = selectedLayer;

  gl.bindVertexArray(paintGPUResources.vao);

  //configure our destination
  const { w, h } = layer;

  gl.bindTexture(gl.TEXTURE_2D, paintGPUResources.renderTexture);
   
  {
    const level = 0;
    const internalFormat = gl.RGBA;
    const border = 0;
    const format = gl.RGBA;
    const type = gl.UNSIGNED_BYTE;
    const data = null;
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, w, h, border, format, type, data);
   
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  //copy our source texture to our paint texture
  {
    console.error( "TODO: BeginPaint Copy source layer texture to paint texture, maybe with draw op, maybe with blit")
  }

  //bind our framebuffer, and reattach the changed texture (no idea if this is necessary on texture reconfig)
  {
    gl.bindFramebuffer(gl.FRAMEBUFFER, paintGPUResources.framebuffer);
     
    // attach the texture as the first color attachment
    const attachmentPoint = gl.COLOR_ATTACHMENT0;
    const level = 0;
    gl.framebufferTexture2D( gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, paintGPUResources.renderTexture, level);
  }

  //upload our brush tip texture
  const brushTipImage = uiSettings.toolsSettings.paint.modeSettings.all.brushTipsImages[ 0 ];
  gl.bindTexture( gl.TEXTURE_2D, paintGPUResources.brushTipTexture );
  {
    const mipLevel = 0,
    internalFormat = gl.RGBA,
    srcFormat = gl.RGBA,
    srcType = gl.UNSIGNED_BYTE;
    gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, brushTipImage );
  }

  //reset our modrect
  //modRect: {x:0,y:0,x2:0,y2:0,w:0,h:0},
  const { modRect } = paintGPUResources;
  modRect.x = Infinity;
  modRect.y = Infinity;
  modRect.x2 = -Infinity;
  modRect.y2 = -Infinity;
  modRect.w = 0;
  modRect.h = 0;

}
function paintGPU( points ) {
  //compute the vertices of our paint rects, tracking them in modrect
  //gl draw them to the framebuffer/renderbuffer
  //the shader matters

  const layer = selectedLayer;

  //vertex array buffer (I'm still very unclear on what this does. What general info does it bind, exactly?)
  gl.bindVertexArray(paintGPUResources.vao);

  //bind the paint framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, paintGPUResources.framebuffer);

  //compute our points
  const vertices = paintGPUResources.vertices;
  vertices.length = ( points.length * 4 ) * 3 * 2; //xyuv[4] * 3 points per triangle * 2 triangles

  /* vector math */
  {
    console.error( "PaintGPU: Needs to do point vector math." );
  }

  /* Update our mod rect from the point limits */
  {
    console.error( "PaintGPU: Needs to update mod rect from point limits" );
  }

  //upload our points
  gl.bindBuffer(gl.ARRAY_BUFFER,paintGPUResources.vertexBuffer);
  gl.bufferData( gl.ARRAY_BUFFER, new Float32Array(paintGPUResources.vertices), gl.STREAM_DRAW );

  //Do we need to reupload this description of our vertex data's structure? Did VAO keep it? Or did we lose it on rebuffering?
  gl.enableVertexAttribArray( paintGPUResources.xyuvInputIndex );
  {
    const size = 4, dType = gl.FLOAT, normalize=false, stride=0, offset=0;
    gl.vertexAttribPointer( paintGPUResources.xyuvInputIndex, size, dType, normalize, stride, offset );
  }

  //set our tip as the tip texture (index 0)
  gl.activeTexture( gl.TEXTURE0 + 0 );
  gl.bindTexture( gl.TEXTURE_2D, paintGPUResources.brushTipTexture );
  gl.uniform1i( paintGPUResources.brushTipIndex, 0 );

  //set our layer as the blend source (index 1)
  gl.activeTexture( gl.TEXTURE0 + 1 );
  gl.bindTexture( gl.TEXTURE_2D, layer.glTexture );
  gl.uniform1i( paintGPUResources.blendSourceIndex, 1 );
  
  //set the paint color
  {
    const brush = uiSettings.toolsSettings.paint.modeSettings.brush;
    const [r,g,b] = brush.colorModes[brush.colorMode].getRGBFloat();
    gl.uniform3f( paintGPUResources.paintColorIndex, r, g, b );
  }

  //set the alpha
  {
    const brush = uiSettings.toolsSettings.paint.modeSettings.all;
    const alpha = brush.brushOpacity;
    gl.uniform3f( paintGPUResources.alphaIndex, alpha );
  }

  //draw the triangles
  {
    const primitiveType = gl.TRIANGLES,
      structStartOffset = 0,
      structCount = vertices.length / 4;
    gl.drawArrays( primitiveType, structStartOffset, structCount );
  }

}
function finalizePaintGPU() {
  //readpixels for our modrect from the old gltexture and this new one,
  //store those pixels in the undo buffer
  //put those pixels in a dataimage and blit onto the layer's preview canvas

  {
    console.error( "PaintGPU Finalize: Download modrect pixels from layertexture to CPU (olddata)" );
    console.error( "PaintGPU Finalize: Download modrect pixels from rendertexture to CPU (newdata)" );
    console.error( "PaintGPU Finalize: Make imagedata and put modrect pixels on layer canvas");
    console.error( "PaintGPU Finalize: flag layer canvas for reupload to GPU");
    console.error( "PaintGPU Finalize: record undo history");
  }

}

const paintCanvases = {
  //tip: null,
  //blend: null,
  tipComposite: null,
  blendFade: null,
  blendSource: null,
  blendSourceData: null,
  modRect: {x:0,y:0,x2:0,y2:0,w:0,h:0},
  firstPaint: false,
  needsReblend: false,
  blendDistanceTraveled: 0,
  brushDistanceTraveled: 0,
  reblendLength: 5,
  blendAlpha: 0.1,
}
function beginPaint() {

  if( ! paintCanvases.tipComposite ) {
    const canvas = document.createElement( "canvas" ),
      context = canvas.getContext( "2d" );
    paintCanvases.tipComposite = { canvas, context };
    //document.body.appendChild( canvas );
    canvas.style = "position:absolute; left:110px; top:120px; width:100px; height:100px; border:1px solid red; pointer-events:none;";
  }
  if( ! paintCanvases.blendFade ) {
    const canvas = document.createElement( "canvas" ),
      context = canvas.getContext( "2d" );
    paintCanvases.blendFade = { canvas, context };
    //document.body.appendChild( canvas );
    canvas.style = "position:absolute; left:220px; top:120px; width:100px; height:100px; border:1px solid red; pointer-events:none;";
  }
  if( ! paintCanvases.blendSource ) {
    const canvas = document.createElement( "canvas" ),
      context = canvas.getContext( "2d" );
    paintCanvases.blendSource = { canvas, context };
    //document.body.appendChild( canvas );
    canvas.style = "position:absolute; left:110px; top:230px; width:100px; height:100px; border:1px solid red; pointer-events:none;";
  }

  //reset the modified rect
  paintCanvases.modRect.x = Infinity;
  paintCanvases.modRect.y = Infinity;
  paintCanvases.modRect.x2 = -Infinity;
  paintCanvases.modRect.y2 = -Infinity;
  paintCanvases.modRect.w = 0;
  paintCanvases.modRect.h = 0;

  //reset our distance trackers
  paintCanvases.brushDistanceTraveled = 0;
  paintCanvases.blendDistanceTraveled = 0;
  paintCanvases.firstPaint = true;
  paintCanvases.needsReblend = false;

  //match our preview to the selected layer
  const preview = layersStack.layers[0];
  preview.w = preview.canvas.width = preview.maskCanvas.width = selectedLayer.w;
  preview.h = preview.canvas.height = preview.maskCanvas.height = selectedLayer.h;
  for( const p of ["topLeft","topRight","bottomLeft","bottomRight"] ) {
    preview[p][0] = selectedLayer[p][0];
    preview[p][1] = selectedLayer[p][1];
  }

  //reset and activate the painter
  painter.queue.length = 0;
  painter.active = true;

  if( uiSettings.activeTool === "mask" ) {
    if( selectedLayer.maskInitialized === false ) {
      //initialize the selected layer's mask if necessary
      if( uiSettings.toolsSettings.paint.mode === "brush" ) {
        //if we're starting painting with a positive stroke, clear the mask
        initializeLayerMask( selectedLayer, "transparent" );
      }
      if( uiSettings.toolsSettings.paint.mode === "erase" ) {
        //if we're starting with erase, solidify the mask (defaults to this anyway tho)
        initializeLayerMask( selectedLayer, "opaque" );
      }
    }
  }
  if( uiSettings.activeTool === "paint" ) {
    //solidify the preview's mask
    const preview = layersStack.layers[0];
    preview.maskContext.fillStyle = "rgb(255,255,255)";
    preview.maskContext.globalCompositeOperation = "copy";
    preview.maskContext.fillRect( 0,0,preview.w,preview.h );
    //reupload preview mask
    flagLayerMaskChanged( preview );
  }

  //when erasing or blending, copy active layer to preview
  if( uiSettings.toolsSettings.paint.mode === "erase" || uiSettings.toolsSettings.paint.mode === "blend" ) {
    const previewContext = layersStack.layers[0].context;
    previewContext.save();
    previewContext.clearRect( 0,0,selectedLayer.w,selectedLayer.h );
    if( uiSettings.activeTool === "mask" ) {
      //when erasing the mask, the preview's alpha needs to perfectly match the mask
      //(this means white shadowing where we have mask but no image)
      previewContext.globalCompositeOperation = "copy";
      previewContext.drawImage( selectedLayer.maskCanvas, 0, 0 );
      previewContext.globalCompositeOperation = "source-atop";
      previewContext.drawImage( selectedLayer.canvas, 0, 0 );
    } 
    if( uiSettings.activeTool === "paint" ) {
      previewContext.globalCompositeOperation = "copy";
      previewContext.drawImage( selectedLayer.canvas, 0, 0 );
    }
    previewContext.restore();
    //and upload to GPU
    flagLayerTextureChanged( layersStack.layers[ 0 ] );
  }

  //the brush tip is now an imported image
  /* {
    //build the brush tip
    const {canvas,context} = paintCanvases.tip;
    //distended shape not yet implemented
    const w = canvas.width = uiSettings.brushSize*2 + uiSettings.brushBlur*4;
    const h = canvas.height = uiSettings.brushSize*2 + uiSettings.brushBlur*4;
    context.clearRect( 0,0,w,h );
    //simple circle and blur for now
    //TODO next:
    //for pencil brush engine: blit a solid color, mask with PNG
    //for blend brush engine: blit a full copy of the destination canvas
    context.save();
    context.translate( w/2,h/2 );
    if( uiSettings.brushBlur > 0 )
      context.filter = "blur(" + uiSettings.brushBlur + "px)";
    context.fillStyle = "black";
    context.beginPath();
    context.moveTo( uiSettings.brushSize/2, 0 );
    context.arc( 0, 0, uiSettings.brushSize/2, 0, 6.284, false );
    context.fill();
    context.restore();
  } */
  //create a copy of our blend source pixels to avoid buffer self-read clashes
  if( uiSettings.toolsSettings.paint.mode === "blend" ) {
    const w = paintCanvases.blendSource.canvas.width = selectedLayer.canvas.width;
    const h = paintCanvases.blendSource.canvas.height = selectedLayer.canvas.height;
    paintCanvases.blendSource.context.clearRect( 0, 0, w, h );
    paintCanvases.blendSource.context.save();
    paintCanvases.blendSource.context.globalCompositeOperation = "copy";
    paintCanvases.blendSource.context.drawImage( selectedLayer.canvas, 0, 0 );
    paintCanvases.blendSource.context.restore();
    //paintCanvases.blendSourceData = paintCanvases.blendSource.getImageData( 0, 0, w, h );
    //paintCanvases.blendSourceData = selectedLayer.context.getImageData( 0, 0,  selectedLayer.w, selectedLayer.h );
  }
  //we re-composite the tip with the blend data and/or color data with every draw
  /* {
    //prep the blend blitter
    const {canvas,context} = paintCanvases.blend;
    //distended shape not yet implemented
    const w = canvas.width = paintCanvases.tip.canvas.width;
    const h = canvas.height = paintCanvases.tip.canvas.height;
    context.save();
    context.clearRect( 0,0,w,h );
    paintCanvases.firstPaint = true;
    if( uiSettings.brushEngine !== "blend" ) {
      if( uiSettings.mask === false ) context.fillStyle = uiSettings.paintColor;
      if( uiSettings.mask === true ) context.fillStyle = "rgb(255,255,255)";
      context.fillRect( 0,0,w,h );
      context.globalCompositeOperation = "destination-in";
      context.drawImage( paintCanvases.tip.canvas, 0, 0 );
    }
    context.restore();
    {
      const {canvas,context} = paintCanvases.blendFade;
      //distended shape not yet implemented
      const w = canvas.width = paintCanvases.tip.canvas.width;
      const h = canvas.height = paintCanvases.tip.canvas.height;
      context.save();
      context.clearRect( 0,0,w,h );
      context.drawImage( paintCanvases.blend.canvas, 0, 0 );
      context.restore();
    }
  } */

  //set the sizes of the blendFade and tipComposite canvas
  {
    const { brushTiltScale, brushSize, brushBlur } = uiSettings.toolsSettings.paint.modeSettings.all;
    //blur is a radius, so we double it for size addition
    //our brush size is also a radius, since it rotates, so we also double it
    const maxSize = brushSize*brushTiltScale*2 + brushSize*brushBlur*2; 
    //const maxSize = brushSize*2 + brushSize*brushBlur*2; 
    paintCanvases.blendFade.canvas.width = maxSize;
    paintCanvases.blendFade.canvas.height = maxSize;
    paintCanvases.tipComposite.canvas.width = maxSize;
    paintCanvases.tipComposite.canvas.height = maxSize;
  }

}
function finalizePaint( strokeLayer, paintLayer ) {

  const modifiedRect = paintCanvases.modRect;

  let oldCanvasData;

  let mx = Math.max( 0, modifiedRect.x - modifiedRect.w*0.25 ),
    my = Math.max( 0, modifiedRect.y - modifiedRect.h*0.25 ),
    mw = Math.min( 1024, modifiedRect.w*1.5 ),
    mh = Math.min( 1024, modifiedRect.h*1.5 );

  if( mw === 0 || mh === 0 ) return;

  //get data for our affected region
  if( uiSettings.activeTool === "mask" ) {
    oldCanvasData = paintLayer.maskContext.getImageData( mx, my, mw, mh );
  } else {
    oldCanvasData = paintLayer.context.getImageData( mx, my, mw, mh );
  }

  let ctx;
  if( uiSettings.activeTool === "mask" ) ctx = paintLayer.maskContext;
  if( uiSettings.activeTool === "paint" ) ctx = paintLayer.context;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = uiSettings.toolsSettings.paint.modeSettings.all.brushOpacity;
  if( uiSettings.toolsSettings.paint.mode === "erase" || uiSettings.toolsSettings.paint.mode === "blend" ) {
    //paint preview has a copy of the paint layer, and for masking, its alpha exactly matches the paint layer.
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = "copy";
  }
  ctx.drawImage( strokeLayer.canvas, 0, 0 );
  if( uiSettings.activeTool === "mask" && uiSettings.toolsSettings.paint.mode === "erase" ) {
    //fill the mask with white after erasing though, only preserving its alpha channel
    ctx.fillStyle = "rgb(255,255,255)";
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillRect( 0,0,paintLayer.w,paintLayer.h );
  }
  ctx.restore();

  //get our new data and record an undo event
  {
    let newCanvasData;
    if( uiSettings.activeTool === "mask" ) newCanvasData = paintLayer.maskContext.getImageData( mx, my, mw, mh );
    else newCanvasData = paintLayer.context.getImageData( mx, my, mw, mh );
    const historyEntry = {
      mask: uiSettings.activeTool === "mask",
      paintLayer,
      oldCanvasData,
      newCanvasData,
      x: mx, y: my,
      w: mw, h: mh,
      undo: () => {
        if( historyEntry.mask === true ) {
          historyEntry.paintLayer.maskContext.putImageData( historyEntry.oldCanvasData, historyEntry.x, historyEntry.y );
          flagLayerMaskChanged( historyEntry.paintLayer, historyEntry );
        } else {
          historyEntry.paintLayer.context.putImageData( historyEntry.oldCanvasData, historyEntry.x, historyEntry.y );
          flagLayerTextureChanged( historyEntry.paintLayer, historyEntry );
        }
      },
      redo: () => {
        if( historyEntry.mask === true ) {
          historyEntry.paintLayer.maskContext.putImageData( historyEntry.newCanvasData, historyEntry.x, historyEntry.y );
          flagLayerMaskChanged( historyEntry.paintLayer, historyEntry );
        } else {
          historyEntry.paintLayer.context.putImageData( historyEntry.newCanvasData, historyEntry.x, historyEntry.y );
          flagLayerTextureChanged( historyEntry.paintLayer, historyEntry );
        }
      }
    }
    recordHistoryEntry( historyEntry );
  }

  //clear the preview
  strokeLayer.context.clearRect( 0,0, strokeLayer.w, strokeLayer.h );

  if( uiSettings.activeTool === "mask" ) {
    //flag the mask for GPU upload
    flagLayerMaskChanged( paintLayer, modifiedRect );
  } else {
    //flag the paintlayer for GPU upload
    flagLayerTextureChanged( paintLayer, modifiedRect );
  }

  //flag the previewlayer for GPU upload since we've cleared it
  flagLayerTextureChanged( strokeLayer, modifiedRect );

}
function applyPaintStroke( points, destinationLayer ) {
  if( points.length < 2 ) return;

  const settings = uiSettings.toolsSettings.paint.modeSettings;
  const { brushTipsImages, brushAspectRatio, brushTiltScale, brushTiltMinAngle, brushSize, brushOpacity, brushBlur, brushSpacing } = settings.all;
  const colorStyle = settings.brush.colorModes[ settings.brush.colorMode ].getColorStyle();
  const { blendBlur, reblendSpacing, reblendAlpha } = settings.blend;

  const scaledBrushSize = brushSize * 1;

  const reblendLength = reblendSpacing * scaledBrushSize;
  //const {} = settings.erase;


  //for now, not slerping vectors, just a line from a to b
  let [bx,by,b_,bPressure,bAltitudeAngle,bAzimuthAngle] = points[ points.length-1 ],
    [ax,ay,a_,aPressure,aAltitudeAngle,aAzimuthAngle] = points[ points.length-2 ];
  
  if( aAltitudeAngle === undefined ) {
    aAltitudeAngle = bAltitudeAngle = aAzimuthAngle = bAzimuthAngle = 0;
  }

  //transform our basis points  
  getTransform();

  let [canvasOriginX,canvasOriginY] = destinationLayer.topLeft,
    [xLegX,xLegY] = destinationLayer.topRight,
    [yLegX,yLegY] = destinationLayer.bottomLeft;
  xLegX -= canvasOriginX; xLegY -= canvasOriginY;
  yLegX -= canvasOriginX; yLegY -= canvasOriginY;
  const lengthXLeg = Math.sqrt( xLegX*xLegX + xLegY*xLegY ),
    lengthYLeg = Math.sqrt( yLegX*yLegX + yLegY*yLegY );
  xLegX /= lengthXLeg; xLegY /= lengthXLeg;
  yLegX /= lengthYLeg; yLegY /= lengthYLeg;

  let [globalTransformAx,globalTransformAy] = [ax,ay],
    [globalTransformBx,globalTransformBy] = [bx,by];
  //we have points in the same global coordinate system as our canvas.

  //transform from canvas origin
  globalTransformAx -= canvasOriginX;
  globalTransformAy -= canvasOriginY;
  globalTransformBx -= canvasOriginX;
  globalTransformBy -= canvasOriginY;

  //cast to canvas space by projecting on legs
  let canvasTransformAx = globalTransformAx*xLegX + globalTransformAy*xLegY,
    canvasTransformAy = globalTransformAx*yLegX + globalTransformAy*yLegY;
  canvasTransformAx *= destinationLayer.w / lengthXLeg;
  canvasTransformAy *= destinationLayer.h / lengthYLeg;
  let canvasTransformBx = globalTransformBx*xLegX + globalTransformBy*xLegY,
    canvasTransformBy = globalTransformBx*yLegX + globalTransformBy*yLegY;
  canvasTransformBx *= destinationLayer.w / lengthXLeg;
  canvasTransformBy *= destinationLayer.h / lengthYLeg;

  //ta[xy] and tb[xy] are the two point coordinates on our canvas where we're painting.
  
  //count our paint pixels
  const pixelSpacing = Math.max( 1, brushSpacing * scaledBrushSize );
  const lineLength = Math.max( 1, parseInt( Math.sqrt( (canvasTransformAx-canvasTransformBx)**2 + (canvasTransformAy-canvasTransformBy)**2 ) / pixelSpacing ) );

  //reblend if necessary (we may be using sub-spacing blending)
  if( uiSettings.toolsSettings.paint.mode === "blend" ) {
    paintCanvases.blendDistanceTraveled += lineLength;
    if( paintCanvases.blendDistanceTraveled >= reblendLength ) {
      paintCanvases.blendDistanceTraveled = 0;
      paintCanvases.needsReblend = true;
    }

    //start by grabbing from our paint canvas for blend
    if( paintCanvases.firstPaint === true || paintCanvases.needsReblend === true ) {

      const w = paintCanvases.blendFade.canvas.width,
        h = paintCanvases.blendFade.canvas.height;
      
      //calculate our blending source cross-fade
      {
        //this doesn't work for blending across transparencies
        paintCanvases.blendFade.context.save();
        if( paintCanvases.firstPaint === true ) {
          paintCanvases.blendFade.context.clearRect( 0, 0, w, h );
          paintCanvases.blendFade.context.globalCompositeOperation = "copy";
          paintCanvases.blendFade.context.globalAlpha = 1.0;
        }
        else if( paintCanvases.needsReblend === true ) {
          paintCanvases.blendFade.context.globalCompositeOperation = "source-over";
          paintCanvases.blendFade.context.globalAlpha = reblendAlpha;
        }
  
        //mix source pixels outo our blendfade canvas
        paintCanvases.blendFade.context.drawImage( paintCanvases.blendSource.canvas, -canvasTransformAx + w/2, -canvasTransformAy + h/2 );
        paintCanvases.blendFade.context.restore();
  
        paintCanvases.firstPaint = false;
        paintCanvases.needsReblend = false;
      }
      /* {
        if( paintCanvases.firstPaint === true ) {
          //copy source pixels outo our blendfade canvas
          //paintCanvases.blendFade.context.save();
          //paintCanvases.blendFade.context.clearRect( 0, 0, w, h );
          //paintCanvases.blendFade.context.globalCompositeOperation = "copy";
          //paintCanvases.blendFade.context.globalAlpha = 1.0;
          //paintCanvases.blendFade.context.drawImage( paintCanvases.blendSource.canvas, -canvasTransformAx + w/2, -canvasTransformAy + h/2 );
          //paintCanvases.blendFade.context.restore();
          const subImageData = paintCanvases.blendFade.context.createImageData( w, h );
          for( let x=-canvasTransformAx + w/2; x<)
    
        }
        else if( paintCanvases.needsReblend === true ) {
          //I need to average them, including averaging their alphas, and IDK how except maths. :-/
          //But! I can optimize this later with a shader, as long as I can make it work at all for now
          const blendFadeData = paintCanvases.blendFade.context.getImageData( 0,0,w,h );
          const sourceData = paintCanvases.blendSource.context.getImageData( -parseInt(canvasTransformAx + w/2), -parseInt(canvasTransformAy + h/2), w, h );
          const b = blendFadeData.data,
            s = sourceData.data,
            j = b.length,
            a = reblendAlpha,
            ia = 1 - a;
          for( let i=0; i<j; i+=4 ) {
            const pa = a * s[i+3]/255,
              ipa = 1 - pa;
            console.log( s[i+3] );
            b[i] = b[i]*ipa + s[i]*pa;
            b[i+1] = b[i+1]*ipa + s[i+1]*pa;
            b[i+2] = b[i+2]*ipa + s[i+2]*pa;
            b[i+3] = (1+b[i+3]*ia) + s[i+3]*a;
          }
          paintCanvases.blendFade.context.putImageData( blendFadeData, 0, 0 );
        }
  
        paintCanvases.firstPaint = false;
        paintCanvases.needsReblend = false;
      } */
      //we're recompositing the tip with every draw
      /* {
        //mask with tip
        paintCanvases.blend.context.save();
        paintCanvases.blend.context.globalAlpha = 1.0;
        paintCanvases.blend.context.globalCompositeOperation = "destination-in";
        paintCanvases.blend.context.drawImage( paintCanvases.tip.canvas, 0, 0 );
        paintCanvases.blend.context.restore();
      } */

    }

  }

  //get our spacing counter
  paintCanvases.brushDistanceTraveled += lineLength;
  if( paintCanvases.brushDistanceTraveled < pixelSpacing ) {
    //no painting to do yet
    return;
  }

  //get our brush color
  let currentColorStyle = "rgba(0,0,0,0)";
  if( uiSettings.toolsSettings.paint.mode === "brush" ) {
    if( uiSettings.activeTool === "mask" ) {
      currentColorStyle = uiSettings.toolsSettings.mask.maskColor;
    }
    if( uiSettings.activeTool === "paint" ) {
      currentColorStyle = colorStyle;
    }
  }
  if( uiSettings.toolsSettings.paint.mode === "erase" || uiSettings.toolsSettings.paint.mode === "blend" ) {
    currentColorStyle = "rgb(255,255,255)";
  }

  //update / expand our paint bounds rectangle
  const modifiedRect = paintCanvases.modRect;
  {
    //max out the rectangle
    modifiedRect.x = parseInt( Math.min( modifiedRect.x, canvasTransformAx - scaledBrushSize*brushTiltScale - scaledBrushSize*brushBlur, canvasTransformBx - scaledBrushSize*brushTiltScale - scaledBrushSize*brushBlur ) );
    modifiedRect.y = parseInt( Math.min( modifiedRect.y, canvasTransformAy - scaledBrushSize*brushTiltScale - scaledBrushSize*brushBlur, canvasTransformBy - scaledBrushSize*brushTiltScale - scaledBrushSize*brushBlur ) );
    modifiedRect.x2 = parseInt( Math.max( modifiedRect.x2, canvasTransformAx + scaledBrushSize*brushTiltScale + scaledBrushSize*brushBlur, canvasTransformBx + scaledBrushSize*brushTiltScale + scaledBrushSize*brushBlur ) );
    modifiedRect.y2 = parseInt( Math.max( modifiedRect.y2, canvasTransformAy + scaledBrushSize*brushTiltScale + scaledBrushSize*brushBlur, canvasTransformBy + scaledBrushSize*brushTiltScale + scaledBrushSize*brushBlur ) );
    modifiedRect.w = modifiedRect.x2 - modifiedRect.x;
    modifiedRect.h = modifiedRect.y2 - modifiedRect.y;
  }

  //we're never collecting undo data during this paint function, because finalization is done by blitting the paint layer, not by repainting.

  const passesModes = [ uiSettings.toolsSettings.paint.mode ];
  
  //when we blend, we first do an erase pass, in order to blend transparent pixels
  if( uiSettings.toolsSettings.paint.mode === "blend" ) passesModes.unshift( "erase" );
  
  //okay! Let's paint the line
  for( const passMode of passesModes ) {
    destinationLayer.context.save();
    if( passMode === "brush" || passMode === "blend" ) {
        destinationLayer.context.globalCompositeOperation = "source-over";
      }
    if( passMode === "erase" ) {
      destinationLayer.context.globalCompositeOperation = "destination-out";
    }
    //TODO OPTIMIZATION: limit sub-rect clip blit
    const tipCompositeWidth = paintCanvases.tipComposite.canvas.width,
      tipCompositeHeight = paintCanvases.tipComposite.canvas.height;
    for( let i=0; i<lineLength; i++ ) {

      //interpolate linearly between the two points
      const linePortionRemaining = i/lineLength,
        linePortionAdvanced = 1 - linePortionRemaining;
      let paintX = canvasTransformBx*linePortionRemaining + canvasTransformAx*linePortionAdvanced,
        paintY = canvasTransformBy*linePortionRemaining + canvasTransformAy*linePortionAdvanced;
      let paintPressure = bPressure*linePortionRemaining + aPressure*linePortionAdvanced,
        altitudeAngle = bAltitudeAngle*linePortionRemaining + aAltitudeAngle*linePortionAdvanced, //against screen z-axis
        azimuthAngle = bAzimuthAngle*linePortionRemaining + aAzimuthAngle*linePortionAdvanced, //around screen, direction pointing
        normalizedAltitudeAngle = 1 - ( altitudeAngle / 1.5707963267948966 ); //0 === perpendicular, 1 === parallel
        //TODO: DEBUG / MAKE RIGHT THIS ANGLE SCALING BEHAVIOR
      let unTiltClippedAltitudeAngle = Math.min( brushTiltMinAngle, normalizedAltitudeAngle ),
        normalizedUnTiltClippedAltitudeAngle = unTiltClippedAltitudeAngle / brushTiltMinAngle,
        tiltClippedAltitudeAngle = Math.max( 0, normalizedAltitudeAngle - brushTiltMinAngle ),
        normalizedClippedAltitudeAngle = tiltClippedAltitudeAngle / ( 1 - brushTiltMinAngle ),
        tiltScale = 1 + normalizedClippedAltitudeAngle * brushTiltScale;
        
      let scaledBrushSize = brushSize * uiSettings.toolsSettings.paint.modeSettings.all.pressureScaleCurve( paintPressure );
      let scaledOpacity = uiSettings.toolsSettings.paint.modeSettings.all.pressureOpacityCurve( paintPressure );

      //composite our tip
      {

        paintCanvases.tipComposite.context.clearRect( 0,0,tipCompositeWidth,tipCompositeHeight );

        //copy over our blendfaded image if we're blending
        if( passMode === "blend" ) {
          paintCanvases.tipComposite.context.save();
          paintCanvases.tipComposite.context.globalCompositeOperation = "copy";
          paintCanvases.tipComposite.context.globalAlpha = 1.0;
          //apply blur
          if( blendBlur > 0 ) {
            paintCanvases.tipComposite.context.filter = "blur(" + blendBlur + "px)";
          }
          paintCanvases.tipComposite.context.drawImage( paintCanvases.blendFade.canvas, 0,0 );
          paintCanvases.tipComposite.context.restore();
        }
        //lay down our color if we're brushing or erasing
        if( passMode === "brush" || passMode === "erase" ) {
          paintCanvases.tipComposite.context.save();
          paintCanvases.tipComposite.context.fillStyle = currentColorStyle;
          paintCanvases.tipComposite.context.fillRect( 0,0,tipCompositeWidth,tipCompositeHeight );
          paintCanvases.tipComposite.context.restore();
        }

        //clip our tip image
        {
          paintCanvases.tipComposite.context.save();
          //set to clip mode
          paintCanvases.tipComposite.context.globalCompositeOperation = "destination-in";
          //apply the tilt and rotation
          paintCanvases.tipComposite.context.translate( tipCompositeWidth/2, tipCompositeHeight/2 );
          paintCanvases.tipComposite.context.rotate( azimuthAngle );
          //apply the blur
          if( brushBlur > 0 ) {
            paintCanvases.tipComposite.context.filter = "blur(" + ( brushBlur * brushSize ) + "px)";
          }
          //draw the tip image
          const tipImageWidth = brushTipsImages[ 0 ].width,
          tipImageHeight = brushTipsImages[ 0 ].height;
          const scaledTipImageWidth = scaledBrushSize * tiltScale,
            scaledTipImageHeight = scaledBrushSize * tipImageHeight / tipImageWidth;
          //if the pen is very vertical, we want to center the brush
          const xOffset = -(scaledTipImageWidth/2) * ( 1 - normalizedUnTiltClippedAltitudeAngle );
          paintCanvases.tipComposite.context.drawImage( brushTipsImages[ 0 ], xOffset, -scaledTipImageHeight/2, scaledTipImageWidth, scaledTipImageHeight );
          paintCanvases.tipComposite.context.restore();
        }

      }

      //paintX and paintY are the two points on our canvas where we're blitting the composited tip.

      //note that destination layer is the preview layer, not the selected layer

      destinationLayer.context.save();
      destinationLayer.context.translate( paintX, paintY );
      /* destinationLayer.context.rotate( Math.atan2( azimuthAngle, altitudeAngle ) );
      destinationLayer.context.scale( tiltScale, 1 ); //pencil tilt shape
      destinationLayer.context.translate( (tipCompositeWidth/2) * ( 1 - (1/tiltScale) ), 0 ); */

      //Brush-slider opacity is applied at the brush-level while erasing.
      //Why? Imagine erasing with a 50% opacity brush on a 50% opacity layer. How do you get that to render onscreen? I don't know.
      if( passMode === "erase" ) {
        destinationLayer.context.globalAlpha = scaledOpacity * brushOpacity;
      }

      if( passMode === "brush" ) {
        //this is a secondary opacity scale from 0 -> 1
        //during preview, the preview layer's opacity is downscaled to max brushOpacity
        //at the finalization step, the blit operation's alpha is downscaled to the 0 -> brushOpacity range
        destinationLayer.context.globalAlpha = scaledOpacity;
      }
      //Okay, here we go...
      destinationLayer.context.drawImage( paintCanvases.tipComposite.canvas, -tipCompositeWidth/2, -tipCompositeHeight/2, tipCompositeWidth, tipCompositeHeight );
      destinationLayer.context.restore();

    }
    destinationLayer.context.restore();
  }

  flagLayerTextureChanged( destinationLayer, modifiedRect );

}

/* function paintPointsToLayer( points, layer ) {

  getTransform();

  //record our modified area
  let modXMin = 1024, modYMin = 1024,
    modXMax = 0, modYMax = 0;

  //Get our canvas coordinate system
  let [x,y] = transformPoint( layer.topLeft ),
    [x2,y2] = transformPoint( layer.topRight ),
    [x3,y3] = transformPoint( layer.bottomLeft );
  x2 -= x; y2 -= y;
  x3 -= x; y3 -= y;
  const vxl = Math.sqrt( x2*x2 + y2*y2 ),
    vyl = Math.sqrt( x3*x3 + y3*y3 );
  const scale = layer.w / vxl;
  x2 /= vxl; y2 /= vxl;
  x3 /= vyl; y3 /= vyl;

  //transform out points into the canvas space, and record the modified region
  const transformedPoints = new Array( points.length );
  for( let i=0; i<points.length; i++ ) {
    const p = points[ i ];
    if( ! p ) continue;
    const [opx,opy] = transformPoint( p );
    const px = opx - x, py = opy - y;
    let dvx = px*x2 + py*y2,
      dvy = px*x3 + py*y3;
    dvx *= scale;
    dvy *= scale;
    if( dvx < modXMin ) modXMin = dvx;
    if( dvy < modYMin ) modYMin = dvy;
    if( dvx > modXMax ) modXMax = dvx;
    if( dvy > modYMax ) modYMax = dvy;
    transformedPoints[i] = [ dvx, dvy ];
  }

  //expand our modified area by the brush size
  modXMin -= uiSettings.brushSize;
  modYMin -= uiSettings.brushSize;
  modXMax += uiSettings.brushSize;
  modYMax += uiSettings.brushSize;

  //expand our modified area by the blur size, + a 5-pixel padding
  modXMin -= uiSettings.brushBlur + 5;
  modYMin -= uiSettings.brushBlur + 5;
  modXMax += uiSettings.brushBlur + 5;
  modYMax += uiSettings.brushBlur + 5;

  //clip our modified area to the canvas
  if( modXMin < 0 ) modXMin = 0;
  if( modYMin < 0 ) modYMin = 0;
  if( modXMax > layer.w ) modXMax = layer.w;
  if( modYMax > layer.h ) modYMax = layer.h;
  let modW = modXMax - modXMin,
    modH = modYMax - modYMin;

  //discretize the clip area
  modXMin = parseInt( modXMin );
  modYMin = parseInt( modYMin );
  modW = Math.min( layer.w, parseInt( modW + 1 ) );
  modH = Math.min( layer.h, parseInt( modH + 1 ) );

  const catx = layer.context;

  let oldCanvasData;

  //get data for our affected region
  if( layer.layerType === "paint" ) {
    oldCanvasData = catx.getImageData( modXMin, modYMin, modW, modH );
  }
  //later we need to compress this to a PNG string, but for now we're not optimizing, just iterating

  catx.save();
  catx.beginPath();
  if( uiSettings.brush === "paint" )
    catx.globalCompositeOperation = "source-over";
  else if( uiSettings.brush === "erase")
    catx.globalCompositeOperation = "destination-out";
  catx.lineCap = "round";
  catx.lineJoin = "round";
  catx.strokeStyle = uiSettings.paintColor;
  catx.lineWidth = uiSettings.brushSize;
  catx.globalAlpha = uiSettings.brushOpacity;
  if( uiSettings.brushBlur > 0 )
    catx.filter="blur(" + uiSettings.brushBlur + "px)";
  let move = true;
  for( const p of transformedPoints ) {
    if( ! p ) continue;
    const [ dvx, dvy ] = p;
    if( move ) {
      move = false;
      catx.moveTo( dvx, dvy );
    } else {
      catx.lineTo( dvx, dvy );
    }
  }
  catx.stroke();
  catx.restore();

  //get our new data and record an undo event
  if( layer.layerType === "paint" ) {
    newCanvasData = catx.getImageData( modXMin, modYMin, modW, modH );
    const historyEntry = {
      oldCanvasData,
      newCanvasData,
      x: modXMin, y: modYMin,
      w: modW, h: modH,
      undo: () => {
        layer.context.putImageData( historyEntry.oldCanvasData, historyEntry.x, historyEntry.y );
        layer.textureChanged = true;
        layer.textureChangedRect.x = historyEntry.x;
        layer.textureChangedRect.y = historyEntry.y;
        layer.textureChangedRect.w = historyEntry.w;
        layer.textureChangedRect.h = historyEntry.h;
      },
      redo: () => {
        layer.context.putImageData( historyEntry.newCanvasData, historyEntry.x, historyEntry.y );
        layer.textureChanged = true;
        layer.textureChangedRect.x = historyEntry.x;
        layer.textureChangedRect.y = historyEntry.y;
        layer.textureChangedRect.w = historyEntry.w;
        layer.textureChangedRect.h = historyEntry.h;
      }
    }
    recordHistoryEntry( historyEntry );
  }

  layer.textureChanged = true;

  //record our changed area
  layer.textureChangedRect.x = modXMin;
  layer.textureChangedRect.y = modYMin;
  layer.textureChangedRect.w = modW;
  layer.textureChangedRect.h = modH;

} */


/* function stroke( ctx, points ) {
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = "black";
    ctx.strokeStyle = uiSettings.paintColor;
    ctx.lineWidth = uiSettings.brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = uiSettings.brushOpacity;
    if( uiSettings.brushBlur > 0 )
      ctx.filter="blur(" + uiSettings.brushBlur + "px)";

    _originMatrix[ 2 ] = -view.origin.x;
    _originMatrix[ 5 ] = -view.origin.y;
    _positionMatrix[ 2 ] = view.origin.x;
    _positionMatrix[ 5 ] = view.origin.y;

    mul3x3( viewMatrices.current , _originMatrix , _transform ); // origin * current
    mul3x3( _transform , viewMatrices.moving , _transform ); // (origin*current) * moving
    mul3x3( _transform , _positionMatrix , _transform ); // transform = ( (origin*current) * moving ) * position

    let move = true;
    for( const p of points ) {
        if( p === null ) {
            move = true;
            continue;
        }
        _tpoint[ 0 ] = p[ 0 ]; 
        _tpoint[ 1 ] = p[ 1 ]; 
        _tpoint[ 2 ] = p[ 2 ];

        mul3x1( _transform , _tpoint , _tpoint );

        ctx[ move ? "moveTo" : "lineTo" ]( _tpoint[ 0 ] , _tpoint[ 1 ] );
        move = false;
    }
    //ctx.stroke();

    ctx.restore();
} */

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

  if( selectedLayer.layerType === "group" )
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
      }
    },
  };
  recordHistoryEntry( historyEntry );

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
/*
TODO: Finish this map and make a simpler map 
    (copy-paste, remove in-function flows)

Map

- VERSION
- cnv, ctx, W, H
- Setup()

- keys{}, keyHandler(e,state)

- perfectlySizeCanvas()

- painter{queue[],active}
- cursor{
    current{x,y}
    mode <"none"|"pan"|"rotate"|"zoom">
    origin{x,y}
    zoomLength:50
}
- pincher {
    ongoing,
    origin{
        a{x,y,id},
        b{x,y,id},
        center{x,y}
        length, angle
    },
    current{
        a{x,y,id},
        b{x,y,id}
    }
}
- pointers{active{},count}

- startHandler(p)
    : compute x,y
    : update pointers.active[]
    : update pointers.count
    : if 1 pointer
        : disable pincher
        : if space
            : update cursor origin, current
            : update cursor mode from buttons
        : if not space
            : activate painter
    >: if not 1 pointer
        : disable cursor
            : mode "none"
            : zero origin, current
    : if 2 pointers
        : enable pincher
        : update pincher origin, current
            from 2 active pointers
        : set pincher origin specials
            (angle, length, center)
    
    : shuttle p to moveHandler
- moveHandler(p)
    : compute x,y
    : if 1 pointer
        : if cursor mode, update current
        : if painter
            : untransform input point
            : push to painter queue
    : update pointers.active[] if applicable
- stopHandler(p)
    : shuttle p to moveHandler
    : if 1 pointer
        : if cursor mode
            : finalizeViewMove()
            : reset cursor mode,origin,current
        : if painter
            : disable painter
            : flush queue to demoPoints[]
    : if 2 pointers
        : finalizeViewMove()
        : delete pointers
        : reset pincher origin, current
    : update pointers.active[]
    : update pointers.count

- demoPoints[], looping
- Loop()
    : animate
    : clear
    : updateCycle()
    : stroke( demoPoints )
    : draw cursor state
    : writeInfo()

- writeInfo()
    : version, view, pincher(origin,current), pointers, width/height, painter

- view{ angle,zoom,pan{x,y},origin{x,y} }
- updateCycle()
    : if 1 pointer
        : if no cursor mode
            view does not update, drawing via painter
        : if cursor mode pan
            : update view (origin, pan{x,y}, moving matrix)
        : if cursor mode zoom
            : update view (origin, zoom, moving matrix )
        : if cursor mode rotate
            : update view (origin, angle, moving matrix)
    : if 2 pointers
        : compute current specials
            (length, angle, center)
        : update view (origin, zoom, angle, pan{x,y}, moving matrix)

- _tpoint[3] , _transform[9]
- stroke( points )
    : black line
    : load _originMatrix, _positionMatrix from view.origin
    : compute _transform = origin * current * moving * position
    : for each point
        : load / compute _tpoint = _transform * point
        : stroke line
    : if painter active
        : for each painter queue point
            : load / compute _tpoint = _transform * point
            : stroke line

- viewMatrices{ current[9], moving[9] }
- _final[9] , _originMatrix[9] , _positionMatrix[9]

*/


async function getImageA1111( {api="txt2img", prompt, seed=-1, sampler="DPM++ SDE", steps=4, cfg=1, width=1024, height=1024, CADS=false, img2img=null, denoise=0.8, inpaint=false, inpaintZoomed=false, inpaintZoomedPadding=32, inpaintFill="original" } ) {
  //apisSettings.a1111.setPrompt(prompt + " <lora:lcm-lora-sdxl:1>");
  //apisSettings.a1111.setPrompt(prompt + " <lora:sdxl_lightning_4step_lora:1>");
  let apiTag = "/sdapi/v1/txt2img";
  apisSettings.a1111.setAPI( api );
  apisSettings.a1111.setPrompt( prompt );
  if( seed === -1 ) seed = parseInt(Math.random()*9999999999);
  apisSettings.a1111.setSeed( seed );
  apisSettings.a1111.setSampler( sampler );
  apisSettings.a1111.setSteps( steps );
  apisSettings.a1111.setCFG( cfg );
  apisSettings.a1111.setSize( width, height );
  if( api==="img2img" ) {
    apiTag = "/sdapi/v1/img2img";
    console.log( "Doing img2img API call." );
    apisSettings.a1111.setImg2Img( img2img );
    apisSettings.a1111.setDenoisingStrength( denoise );
    if( inpaint === true ) {
      console.log( "Doing inpainting API call, with inpaintZoomed: ", inpaintZoomed );
      apisSettings.a1111.setInpaintFullRes( (inpaintZoomed === true) ? 1 : 0 ),
      apisSettings.a1111.setInpaintFullResPad( inpaintZoomedPadding ),
      apisSettings.a1111.setInpaintFill( inpaintFill ); //"fill", "original", "latent noise", "latent nothing"
    }
  }
  if( CADS ) apisSettings.a1111.CADS.enable();
  else apisSettings.a1111.CADS.disable();
  return new Promise( async returnImage => {	
    const response = await process( apisSettings.a1111.getAPI(), apiTag, 7860 );
    console.log( response );
    const imageSrc = "data:image/png;base64," + response.images[0];
    const img = new Image();
    img.onload = () => {
        currentImage = img;
        returnImage( img );
    }
    img.src = imageSrc;
  } );
}

async function getLineartA1111( {image,res=1024,module="lineart_anime_denoise"} ) {
  apisSettings.a1111.setPreprocessor( { module, image, res } );
  return new Promise( async returnImage => {
    const response = await process( apis.a1111controlnet, "/controlnet/detect", 7860 );
    console.log( "Controlnet response: ", response );
    const imageSrc = "data:image/png;base64," + response.images[0];
    const img = new Image();
    img.onload = () => {
        currentImage = img;
        returnImage( img );
    }
    img.src = imageSrc;
  })
}

async function getImageComfy( prompt ) {
  //https://github.com/comfyanonymous/ComfyUI/blob/master/script_examples/websockets_api_example.py
  apisSettings.comfyLCM.setPrompt(prompt);
  const apiData = {prompt:apis.comfyLCM};
  const rsp = await process( apiData, "prompt", 8188 );
  console.log(rsp);
  const promptId = rsp.prompt_id;
  const history = await process( null, "history/" + promptId, 8188 );
  console.log( history ); //returned empty, should have returned filename :-(
}

const apisSettings = {
  a1111: {
      setAPI: apiKey => apisSettings.a1111.apiKey = "a1111" + apiKey,
      setPrompt: prompt => apis[apisSettings.a1111.apiKey].prompt = prompt,
      setSeed: seed => apis[apisSettings.a1111.apiKey].seed = seed,
      setSampler: samplerName => apis[apisSettings.a1111.apiKey].sampler_name = samplerName,
      samplerNames: [ "DPM++ SDE","DPM++ 3M SDE Exponential", "Euler" ],
      modelNames: [ "SDXL-Juggernaut-Lightning-4S.DPMppSDE.832x1216.CFG1-2", "SDXL-ProteusV0.3.safetensors [29b6b524ce]", "SDXL-3XV3.safetensors [b190397c8a]",  ],
      setSteps: steps => apis[apisSettings.a1111.apiKey].steps = steps,
      setCFG: cfg => apis[apisSettings.a1111.apiKey].cfg_scale = cfg,
      setSize: (w,h) => { apis[apisSettings.a1111.apiKey].width=w; apis[apisSettings.a1111.apiKey].height=h; },
      setImg2Img: img2img => { apis[apisSettings.a1111.apiKey].init_images[0] = img2img; },
      setDenoisingStrength: denoise => { apis[apisSettings.a1111.apiKey].denoising_strength = denoise; },
      setInpaintFullRes: fullRes => { apis[apisSettings.a1111.apiKey].inpaint_full_res = fullRes; },
      setInpaintFullResPad: fullResPad => { apis[apisSettings.a1111.apiKey].inpaint_full_res_padding = fullResPad; },
      setInpaintFill: fill => { apis[apisSettings.a1111.apiKey].inpaint_fill = ({"fill":0,"original":1,"latent noise":2,"latent nothing":3})[fill] },
      setControlNet: ( { enabled=true, slot=0, lineart=null, lineartStrength=0.8, model="sai_xl_sketch_256lora [cd3389b1]" } ) => {
        const configs = [
          apis.a1111img2img.alwayson_scripts.ControlNet.args[slot],
          apis.a1111txt2img.alwayson_scripts.ControlNet.args[slot],
        ]
        for( const config of configs ) {
          config.enabled = enabled;
          config.image = { image:lineart, mask:lineart };
          config.model = model;          
          config.weight = lineartStrength;
        }
      },
      
      CADS: {
        enable: () => {},
        disable: () => {}
      },
      CADS_original: {
          enable: () => apis[apisSettings.a1111.apiKey].alwayson_scripts.CADS.args[0] = true,
          disable: () => apis[apisSettings.a1111.apiKey].alwayson_scripts.CADS.args[0] = false
      },
      apiKey: "a1111txt2img",
      getAPI: () => apis[apisSettings.a1111.apiKey],
      
      preprocessorNames: ["lineart_realistic","lineart_coarse","lineart_anime","lineart_anime_denoise"],
      setPreprocessor: ( {module,image,res=1024,a=64,b=64} ) => {
        apis.a1111controlnet.controlnet_module = module;
        apis.a1111controlnet.controlnet_input_images[ 0 ] = image;
        apis.a1111controlnet.controlnet_processor_res = res;
        apis.a1111controlnet.controlnet_threshold_a = a;
        apis.a1111controlnet.controlnet_threshold_b = b;
      },
  },
  comfyLCM: {
      setPrompt: t => apis.comfyLCM["62"]["inputs"].text = t,
  }
}

const apis = {
  a1111controlnet: {
    "controlnet_module": "none",
    "controlnet_input_images": [],
    "controlnet_processor_res": 512,
    "controlnet_threshold_a": 64,
    "controlnet_threshold_b": 64,
    "low_vram": false
  },
  a1111img2img: {
    "alwayson_scripts": {
      "ControlNet": {
        "args": [
          {
            "advanced_weighting" : null,
            "batch_images" : "",
            "control_mode" : "Balanced",
            "enabled" : false,
            "guidance_end" : 1,
            "guidance_start" : 0,
            "hr_option" : "Both",
            "image" :
            {
                "image" : null,
                "mask" : null,
            }
            ,
            "inpaint_crop_input_image" : false,
            "input_mode" : "simple",
            "is_ui" : true,
            "loopback" : false,
            "low_vram" : false,
            "model" : "sai_xl_sketch_256lora [cd3389b1]",
            "module" : "none",
            "output_dir" : "",
            "pixel_perfect" : true,
            "processor_res" : -1,
            "resize_mode" : "Crop and Resize",
            "save_detected_map" : true,
            "threshold_a" : -1,
            "threshold_b" : -1,
            "weight" : 0.8
          }
        ]
      },
    },
    "batch_size": 1,
    "cfg_scale": 1,
    "comments": {},
    "denoising_strength": 0.74,
    "disable_extra_networks": false,
    "do_not_save_grid": false,
    "do_not_save_samples": false,
    "height": 1024,
    "image_cfg_scale": 1.5,
    "init_images": [
      "base64image placeholder"
    ],
    "initial_noise_multiplier": 1,
    "inpaint_full_res": 0,
    "inpaint_full_res_padding": 32,
    "inpainting_fill": 1,
    "inpainting_mask_invert": 0,
    "mask_blur": 4,
    "mask_blur_x": 4,
    "mask_blur_y": 4,
    "n_iter": 1,
    "negative_prompt": "",
    "override_settings": {},
    "override_settings_restore_afterwards": true,
    "prompt": "",
    "resize_mode": 0,
    "restore_faces": false,
    "s_churn": 0,
    "s_min_uncond": 0,
    "s_noise": 1,
    "s_tmax": null,
    "s_tmin": 0,
    "sampler_name": "DPM++ SDE",
    "script_args": [],
    "script_name": null,
    "seed": 1930619812,
    "seed_enable_extras": true,
    "seed_resize_from_h": -1,
    "seed_resize_from_w": -1,
    "steps": 4,
    "styles": [],
    "subseed": 3903236052,
    "subseed_strength": 0,
    "tiling": false,
    "width": 1024
  },
  a1111img2img_original: {
    "alwayson_scripts": {
      "API payload": {
        "args": []
      },
      "Agent Attention": {
        "args": [
          false,
          false,
          20,
          4,
          4,
          0.4,
          0.95,
          2,
          2,
          0.4,
          0.5,
          false,
          1,
          false
        ]
      },
      "AnimateDiff": {
        "args": [
          {
            "batch_size": 16,
            "closed_loop": "R-P",
            "enable": false,
            "format": [
              "GIF",
              "PNG"
            ],
            "fps": 8,
            "interp": "Off",
            "interp_x": 10,
            "last_frame": null,
            "latent_power": 1,
            "latent_power_last": 1,
            "latent_scale": 32,
            "latent_scale_last": 32,
            "loop_number": 0,
            "model": "mm_sd_v14.ckpt",
            "overlap": -1,
            "request_id": "",
            "stride": 1,
            "video_length": 16,
            "video_path": "",
            "video_source": null
          }
        ]
      },
      "CADS": {
        "args": [
          false,
          0.6,
          0.9,
          0.25,
          1,
          true,
          false
        ]
      },
      "Characteristic Guidance": {
        "args": [
          1,
          1,
          50,
          0,
          1,
          -4,
          1,
          0.4,
          0.5,
          2,
          false,
          "[How to set parameters? Check our github!](https://github.com/scraed/CharacteristicGuidanceWebUI/tree/main)",
          "More ControlNet",
          0,
          1
        ]
      },
      "ControlNet": {
        "args": [
          {
            "advanced_weighting" : null,
            "batch_images" : "",
            "control_mode" : "Balanced",
            "enabled" : false,
            "guidance_end" : 1,
            "guidance_start" : 0,
            "hr_option" : "Both",
            "image" :
            {
                "image" : null,
                "mask" : null,
            }
            ,
            "inpaint_crop_input_image" : false,
            "input_mode" : "simple",
            "is_ui" : true,
            "loopback" : false,
            "low_vram" : false,
            "model" : "sai_xl_sketch_256lora [cd3389b1]",
            "module" : "none",
            "output_dir" : "",
            "pixel_perfect" : true,
            "processor_res" : -1,
            "resize_mode" : "Crop and Resize",
            "save_detected_map" : true,
            "threshold_a" : -1,
            "threshold_b" : -1,
            "weight" : 0.8
          },
          {
            "advanced_weighting": null,
            "batch_images": "",
            "control_mode": "Balanced",
            "enabled": false,
            "guidance_end": 1,
            "guidance_start": 0,
            "hr_option": "Both",
            "image": null,
            "inpaint_crop_input_image": false,
            "input_mode": "simple",
            "is_ui": true,
            "loopback": false,
            "low_vram": false,
            "model": "None",
            "module": "none",
            "output_dir": "",
            "pixel_perfect": false,
            "processor_res": -1,
            "resize_mode": "Crop and Resize",
            "save_detected_map": true,
            "threshold_a": -1,
            "threshold_b": -1,
            "weight": 1
          },
          {
            "advanced_weighting": null,
            "batch_images": "",
            "control_mode": "Balanced",
            "enabled": false,
            "guidance_end": 1,
            "guidance_start": 0,
            "hr_option": "Both",
            "image": null,
            "inpaint_crop_input_image": false,
            "input_mode": "simple",
            "is_ui": true,
            "loopback": false,
            "low_vram": false,
            "model": "None",
            "module": "none",
            "output_dir": "",
            "pixel_perfect": false,
            "processor_res": -1,
            "resize_mode": "Crop and Resize",
            "save_detected_map": true,
            "threshold_a": -1,
            "threshold_b": -1,
            "weight": 1
          }
        ]
      },
      "Dynamic Prompts v2.17.1": {
        "args": [
          true,
          false,
          1,
          false,
          false,
          false,
          1.1,
          1.5,
          100,
          0.7,
          false,
          false,
          true,
          false,
          false,
          0,
          "Gustavosta/MagicPrompt-Stable-Diffusion",
          ""
        ]
      },
      "Extra options": {
        "args": []
      },
      "Hotshot-XL": {
        "args": [
          null
        ]
      },
      "Hypertile": {
        "args": []
      },
      "Kohya Hires.fix": {
        "args": [
          false,
          true,
          3,
          4,
          0.15,
          0.3,
          "bicubic",
          0.5,
          2,
          true,
          false
        ]
      },
      "Refiner": {
        "args": [
          false,
          "",
          0.8
        ]
      },
      "Seed": {
        "args": [
          -1,
          false,
          -1,
          0,
          0,
          0
        ]
      },
      "Txt/Img to 3D Model": {
        "args": []
      }
    },
    "batch_size": 1,
    "cfg_scale": 1,
    "comments": {},
    "denoising_strength": 0.74,
    "disable_extra_networks": false,
    "do_not_save_grid": false,
    "do_not_save_samples": false,
    "height": 1024,
    "image_cfg_scale": 1.5,
    "init_images": [
      "base64image placeholder"
    ],
    "initial_noise_multiplier": 1,
    "inpaint_full_res": 0,
    "inpaint_full_res_padding": 32,
    "inpainting_fill": 1,
    "inpainting_mask_invert": 0,
    "mask_blur": 4,
    "mask_blur_x": 4,
    "mask_blur_y": 4,
    "n_iter": 1,
    "negative_prompt": "",
    "override_settings": {},
    "override_settings_restore_afterwards": true,
    "prompt": "",
    "resize_mode": 0,
    "restore_faces": false,
    "s_churn": 0,
    "s_min_uncond": 0,
    "s_noise": 1,
    "s_tmax": null,
    "s_tmin": 0,
    "sampler_name": "DPM++ SDE",
    "script_args": [],
    "script_name": null,
    "seed": 1930619812,
    "seed_enable_extras": true,
    "seed_resize_from_h": -1,
    "seed_resize_from_w": -1,
    "steps": 4,
    "styles": [],
    "subseed": 3903236052,
    "subseed_strength": 0,
    "tiling": false,
    "width": 1024
  },
  a1111txt2img: {
      "alwayson_scripts": {
        "ControlNet": {
          "args": [
            {
              "advanced_weighting": null,
              "batch_images": "",
              "control_mode": "Balanced",
              "enabled": false,
              "guidance_end": 1,
              "guidance_start": 0,
              "hr_option": "Both",
              "image": null,
              "inpaint_crop_input_image": false,
              "input_mode": "simple",
              "is_ui": true,
              "loopback": false,
              "low_vram": false,
              "model": "None",
              "module": "none",
              "output_dir": "",
              "pixel_perfect": false,
              "processor_res": -1,
              "resize_mode": "Crop and Resize",
              "save_detected_map": true,
              "threshold_a": -1,
              "threshold_b": -1,
              "weight": 1
            }
          ]
        }
      },
      "batch_size": 1,
      "cfg_scale": 7,
      "comments": {},
      "disable_extra_networks": false,
      "do_not_save_grid": false,
      "do_not_save_samples": false,
      "enable_hr": false,
      "height": 1024,
      "hr_negative_prompt": "",
      "hr_prompt": "",
      "hr_resize_x": 0,
      "hr_resize_y": 0,
      "hr_scale": 2,
      "hr_second_pass_steps": 0,
      "hr_upscaler": "Latent",
      "n_iter": 1,
      "negative_prompt": "",
      "override_settings": {},
      "override_settings_restore_afterwards": true,
      "prompt": "a spaceship with a warpdrive on a trading card, straight and centered in the screen, vertical orientation",
      "restore_faces": false,
      "s_churn": 0,
      "s_min_uncond": 0,
      "s_noise": 1,
      "s_tmax": null,
      "s_tmin": 0,
      "sampler_name": "DPM++ 3M SDE Exponential",
      "script_args": [],
      "script_name": null,
      "seed": 3718586839,
      "seed_enable_extras": true,
      "seed_resize_from_h": -1,
      "seed_resize_from_w": -1,
      "steps": 50,
      "styles": [],
      "subseed": 4087077444,
      "subseed_strength": 0,
      "tiling": false,
      "width": 1024
    },
  a1111txt2img_original: {
      "alwayson_scripts": {
        "API payload": {
          "args": []
        },
        "Agent Attention": {
          "args": [
            false,
            false,
            20,
            4,
            4,
            0.4,
            0.95,
            2,
            2,
            0.4,
            0.5,
            false,
            1,
            false
          ]
        },
        "AnimateDiff": {
          "args": [
            {
              "batch_size": 8,
              "closed_loop": "R-P",
              "enable": false,
              "format": [
                "GIF",
                "PNG"
              ],
              "fps": 8,
              "interp": "Off",
              "interp_x": 10,
              "last_frame": null,
              "latent_power": 1,
              "latent_power_last": 1,
              "latent_scale": 32,
              "latent_scale_last": 32,
              "loop_number": 0,
              "model": "mm_sd_v14.ckpt",
              "overlap": -1,
              "request_id": "",
              "stride": 1,
              "video_length": 16,
              "video_path": "",
              "video_source": null
            }
          ]
        },
        "CADS": {
          "args": [
            true, //probably active/inactive
            0.6,
            0.9,
            0.25,
            1,
            true,
            false
          ]
        },
        "Characteristic Guidance": {
          "args": [
            1,
            1,
            50,
            0,
            1,
            -4,
            1,
            0.4,
            0.5,
            2,
            false,
            "[How to set parameters? Check our github!](https://github.com/scraed/CharacteristicGuidanceWebUI/tree/main)",
            "More ControlNet",
            0,
            1
          ]
        },
        "ControlNet": {
          "args": [
            {
              "advanced_weighting": null,
              "batch_images": "",
              "control_mode": "Balanced",
              "enabled": false,
              "guidance_end": 1,
              "guidance_start": 0,
              "hr_option": "Both",
              "image": null,
              "inpaint_crop_input_image": false,
              "input_mode": "simple",
              "is_ui": true,
              "loopback": false,
              "low_vram": false,
              "model": "None",
              "module": "none",
              "output_dir": "",
              "pixel_perfect": false,
              "processor_res": -1,
              "resize_mode": "Crop and Resize",
              "save_detected_map": true,
              "threshold_a": -1,
              "threshold_b": -1,
              "weight": 1
            },
            {
              "advanced_weighting": null,
              "batch_images": "",
              "control_mode": "Balanced",
              "enabled": false,
              "guidance_end": 1,
              "guidance_start": 0,
              "hr_option": "Both",
              "image": null,
              "inpaint_crop_input_image": false,
              "input_mode": "simple",
              "is_ui": true,
              "loopback": false,
              "low_vram": false,
              "model": "None",
              "module": "none",
              "output_dir": "",
              "pixel_perfect": false,
              "processor_res": -1,
              "resize_mode": "Crop and Resize",
              "save_detected_map": true,
              "threshold_a": -1,
              "threshold_b": -1,
              "weight": 1
            },
            {
              "advanced_weighting": null,
              "batch_images": "",
              "control_mode": "Balanced",
              "enabled": false,
              "guidance_end": 1,
              "guidance_start": 0,
              "hr_option": "Both",
              "image": null,
              "inpaint_crop_input_image": false,
              "input_mode": "simple",
              "is_ui": true,
              "loopback": false,
              "low_vram": false,
              "model": "None",
              "module": "none",
              "output_dir": "",
              "pixel_perfect": false,
              "processor_res": -1,
              "resize_mode": "Crop and Resize",
              "save_detected_map": true,
              "threshold_a": -1,
              "threshold_b": -1,
              "weight": 1
            }
          ]
        },
        "Dynamic Prompts v2.17.1": {
          "args": [
            true,
            false,
            1,
            false,
            false,
            false,
            1.1,
            1.5,
            100,
            0.7,
            false,
            false,
            true,
            false,
            false,
            0,
            "Gustavosta/MagicPrompt-Stable-Diffusion",
            ""
          ]
        },
        "Extra options": {
          "args": []
        },
        "Hotshot-XL": {
          "args": [
            {
              "batch_size": 8,
              "enable": false,
              "format": [
                "GIF"
              ],
              "fps": 8,
              "loop_number": 0,
              "model": "hsxl_temporal_layers.f16.safetensors",
              "negative_original_size_height": 1080,
              "negative_original_size_width": 1920,
              "negative_target_size_height": 512,
              "negative_target_size_width": 512,
              "original_size_height": 1080,
              "original_size_width": 1920,
              "overlap": -1,
              "reverse": [],
              "stride": 1,
              "target_size_height": 512,
              "target_size_width": 512,
              "video_length": 8
            }
          ]
        },
        "Hypertile": {
          "args": []
        },
        "Kohya Hires.fix": {
          "args": [
            false,
            true,
            3,
            4,
            0.15,
            0.3,
            "bicubic",
            0.5,
            2,
            true,
            false
          ]
        },
        "Refiner": {
          "args": [
            false,
            "",
            0.8
          ]
        },
        "Seed": {
          "args": [
            -1,
            false,
            -1,
            0,
            0,
            0
          ]
        },
        "Txt/Img to 3D Model": {
          "args": []
        }
      },
      "batch_size": 1,
      "cfg_scale": 7,
      "comments": {},
      "disable_extra_networks": false,
      "do_not_save_grid": false,
      "do_not_save_samples": false,
      "enable_hr": false,
      "height": 1024,
      "hr_negative_prompt": "",
      "hr_prompt": "",
      "hr_resize_x": 0,
      "hr_resize_y": 0,
      "hr_scale": 2,
      "hr_second_pass_steps": 0,
      "hr_upscaler": "Latent",
      "n_iter": 1,
      "negative_prompt": "",
      "override_settings": {},
      "override_settings_restore_afterwards": true,
      "prompt": "a spaceship with a warpdrive on a trading card, straight and centered in the screen, vertical orientation",
      "restore_faces": false,
      "s_churn": 0,
      "s_min_uncond": 0,
      "s_noise": 1,
      "s_tmax": null,
      "s_tmin": 0,
      "sampler_name": "DPM++ 3M SDE Exponential",
      "script_args": [],
      "script_name": null,
      "seed": 3718586839,
      "seed_enable_extras": true,
      "seed_resize_from_h": -1,
      "seed_resize_from_w": -1,
      "steps": 50,
      "styles": [],
      "subseed": 4087077444,
      "subseed_strength": 0,
      "tiling": false,
      "width": 1024
    },
  comfyLCM:{
      "60": {
        "inputs": {
          "seed": 760882005325423,
          "steps": 4,
          "cfg": 1.5,
          "sampler_name": "lcm",
          "scheduler": "simple",
          "denoise": 1,
          "model": [
            "65",
            0
          ],
          "positive": [
            "62",
            0
          ],
          "negative": [
            "63",
            0
          ],
          "latent_image": [
            "64",
            0
          ]
        },
        "class_type": "KSampler",
        "_meta": {
          "title": "KSampler"
        }
      },
      "61": {
        "inputs": {
          "ckpt_name": "SDXL-ProteusV0.3.safetensors"
        },
        "class_type": "CheckpointLoaderSimple",
        "_meta": {
          "title": "Load Checkpoint"
        }
      },
      "62": {
        "inputs": {
          "text": "A kitten writing with a pen on a digital art tablet.",
          "clip": [
            "65",
            1
          ]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {
          "title": "CLIP Text Encode (Prompt)"
        }
      },
      "63": {
        "inputs": {
          "text": "",
          "clip": [
            "65",
            1
          ]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {
          "title": "CLIP Text Encode (Prompt)"
        }
      },
      "64": {
        "inputs": {
          "width": 1024,
          "height": 1024,
          "batch_size": 1
        },
        "class_type": "EmptyLatentImage",
        "_meta": {
          "title": "Empty Latent Image"
        }
      },
      "65": {
        "inputs": {
          "lora_name": {
            "content": "lcm-lora-sdxl.safetensors",
            "image": null
          },
          "strength_model": 1,
          "strength_clip": 1,
          "example": "[none]",
          "model": [
            "61",
            0
          ],
          "clip": [
            "61",
            1
          ]
        },
        "class_type": "LoraLoader|pysssss",
        "_meta": {
          "title": "Lora Loader 🐍"
        }
      },
      "66": {
        "inputs": {
          "samples": [
            "60",
            0
          ],
          "vae": [
            "61",
            2
          ]
        },
        "class_type": "VAEDecode",
        "_meta": {
          "title": "VAE Decode"
        }
      },
      "68": {
        "inputs": {
          "filename_prefix": "ComfyUIAPI",
          "images": [
            "66",
            0
          ]
        },
        "class_type": "SaveImage",
        "_meta": {
          "title": "Save Image"
        }
      }
    }
}

async function process( data, apiTag, port=7860 ) {
return new Promise( returnImage => {
  const req = new XMLHttpRequest();
  req.addEventListener( "load", e => {
    const rsp = JSON.parse( req.response );//?.choices?.[0]?.text;
    returnImage( rsp );
  } );
      if( data ) {
          const reqData = {
              method: "POST",
              url: "http://127.0.0.1:"+port + apiTag,
              path: apiTag,//path: "/sdapi/v1/txt2img",
              host: '127.0.0.1',
              port: port, //port: '7860',
              apiData: data
          }
          req.open( "POST", "/api" );
          req.send(new Blob([JSON.stringify(reqData)],{"Content-Type":"application/json"}));
      } else {
          throw console.error( "Reflective-GET unimplemented." );
          req.open("GET", "http://127.0.0.1:"+port+"/" + apiTag );
          req.send();
      }
} );
}

async function demoApiCall() {
  const result = await executeAPICall(
    "A1111 Lightning Demo",
    {
      "prompt": "desktop cat wearing a fedora",
      "seed": 123456789,
      //the others should hopefully be auto-populated... or be already set because I defined them that way...
    }
  );
  console.log( result );
}

const wait = delay => new Promise( land => setTimeout( land, delay ) );

const apiExecutionQueue = [];

async function executeAPICall( name, controlValues ) {

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
  //for( apiCall of apiFlow.apiCalls ) {
    const apiCall = apiFlow.apiCalls[ i ];
    //console.log( "On apicall ", apiCall.apiCallName )

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
              //console.log( "Finished reading raw file as dataURL: " + reader.result.substring( 0, 20 ) + "..." );
              const img = new Image();
              img.onload = () => {
                //console.log( "Finished loading image from dataURL and storing in result ",  resultSchemeExpectingRawFile.resultName );
                results[ resultSchemeExpectingRawFile.resultName ] = img;
                complete( true );
              }
              img.onerror = () => {
                console.error( "Failed to read xhr.response as good data url. Try something else?" );
              };
              img.src = reader.result;
              
            }
            //console.log( "Going to try reading response as file | type ", xhr.responseType, " | ", typeof xhr.response );
            //Hmm... Isn't it cached now? Can't I just set the URL as my image url? No... Because it's reflected. :-/ Hmm.
            //reader.readAsDataURL( new Blob( [xhr.response], { type: "image/png" } ) );
            reader.readAsDataURL( xhr.response );

          }
        }
        else {
          let jsonResponse;

          if( (xhr.response === "" || xhr.response === "{}") && apiCall.retryOnEmpty ) {
            //console.log( "Got empty response. Retrying in ", uiSettings.retryAPIDelay, " ms." );
            await wait( uiSettings.retryAPIDelay );
            complete( "retry" );
            return;
            //Else continue. An API call may not need to return anything, after all.
          }

          try {
            jsonResponse = JSON.parse( xhr.response );
          }
          catch ( e ) {
              console.error( "Not JSON. Alert api call failed. Response: ", xhr.response );
              complete( false );
          }
          if( jsonResponse ) {
            console.log( "Got API JSON response: ", jsonResponse );

            for( const resultScheme of apiCall.results ) {
              //console.log( "Starting with result ", resultScheme );
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
                if( resultScheme.resultType === "array-object" ) {
                  //results[ resultScheme.resultName ] = jsonResponse;
                  proceed( true );
                }
                if( resultScheme.resultType === "array-string" ) {
                  //console.log( "Updated results: ", results );
                  results[ resultScheme.resultName ] = results[ resultScheme.resultName ][ 0 ]; //THIS IS A BUG! I don't know why I need this line. :-|
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
            //console.log( "Now have accumulated results: ", results );
            //populated all results
            complete( true );
          }
        }
      }
      //load api values from controls
      for( const controlScheme of apiFlow.controls ) {
        //console.log( "On controlscheme ", controlScheme.controlName );
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

            //just ignore this line...
            if( isApiOrConfig === "host" && apiCall.host === "device" ) { throw console.error( "Unsafe behavior! An API control may be trying to redirect an API call to an external service." ); }

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
            //console.log( "Assigning result ", retrievedResult, " to target ", target[ controlPath[ 0 ] ] );
            target[ controlPath.shift() ] = retrievedResult;
          }

          else if( controlScheme.controlType === "string-compose" ) {
            //check if this is an api-result from the current apicall, probably unnecessary given
            /* if( controlScheme.controlPath[ 0 ] !== apiCall.apiCallName ) {
              console.log( "Ignoring control ", controlScheme.controlName, " just during apicall ", apiCall.apiCallName );
              continue; //nothing to set from here
            } */
            let composedString = "";
            for( const composePath of controlScheme.composePaths ) {
              const compositionPath = [ ...composePath ];
              if( typeof composePath === "string" ) composedString += composePath;
              else {
                const controlName = compositionPath.shift();
                //console.log( "Looking up controlname for composition: ", controlName );
                let lookup = apiFlow.controls.find( c => c.controlName === controlName );
                for( let i=0; i<compositionPath.length; i++ ) 
                  lookup = lookup[ compositionPath[ i ] ]; //incase controlValue is an obj{} IDK
                //console.log( "Got loookup ", lookup, " from path ", compositionPath );
                composedString += lookup;
              }
            }
            //console.log( "Installing composed string ", composedString, " onto target ", target[ controlPath[ 0 ] ] );
            target[ controlPath.shift() ] = composedString;
          }

          else if( controlValues.hasOwnProperty( controlScheme.controlName ) )
            target[ controlPath.shift() ] = controlValues[ controlScheme.controlName ];

          else target[ controlPath.shift() ] = controlScheme.controlValue;

        }
      }
      if( apiCall.host === "device" ) {
        if( apiCall.method === "POST" ) {
          const postData = {
            method: "POST",
            //url: "http://127.0.0.1:"+ apiCall.port + apiCall.apiPath,
            path: apiCall.apiPath,//path: "/sdapi/v1/txt2img",
            host: "device",
            port: apiCall.port, //port: '7860',
            dataFormat: apiCall.dataFormat,
            convertDataImages: !!apiCall.convertDataImages,
            apiData: apiCall.api
          }
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
            host: "device",
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
      //console.log( "Finished API call successfully with results: ", results );
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
      //console.log( "Mapping outputscheme ", outputScheme, " with result ", result );
      const library = assetsLibrary[ outputScheme.outputLibraryName ] ||= [];
      const mappedAssets = [];
      for( const resultEntry of result ) {
        const mappedAsset = {};
        for( const {key,path} of outputScheme.assetMap ) {
          mappedAsset[ key ] = resultEntry;
          for( let i=0; i<path.length; i++ )
            mappedAsset[ key ] = mappedAsset[ key ]?.[ path[ i ] ];
        }
        library.push( mappedAsset );
        mappedAssets.push( mappedAsset );
      }
      outputs[ outputScheme.outputName ] = mappedAssets;
    }
  }
  console.log( "Finished apiFlow with outputs: ", outputs );

  apiExecutionQueue.splice( apiExecutionQueue.indexOf( selfQueue ), 1 );

  return outputs;
}

const assetsLibrary = {}

//a 3w*2h image with random colors and a solid alpha channel
const testImageURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAI0lEQVQIW2P86qL8/+hjPoazEzYzME5ljf5/WzOWQf6GJgMAnNkKmdnTKGIAAAAASUVORK5CYII=";

/* 

Build a simple workflow to start, don't worry about styling the controls just make it work,
and get a gen onscreen again finally

asset browser has to fit above keyboard on tablet. small icons, large preview is the way to go.

*/

const apiFlows = [
  {
    isDemo: true,
    apiFlowType: "asset", //or something
    //IDK what else goes here
  },
  {
    isDemo: true,
    apiFlowName: "", //also eventually tags
    apiFlowType: "generate-image",
    controls: [
      {
        controlName: "",
        controlType: "", //text | static | randomInt | number{min,max,step} | option(unimp) | asset(unimp) | image(unimp) | duplicate
          //duplicate must be listed *after* source or updates will not propagate correctly!
        controlValue: "",
        controlPath: [], //host|port|apiPath|api -> "",...
        //type can be asset input
        //or can be input: text, numbers in ranges, image(layer)
        //or can be link: apiCall.result -> apiCall.path
        //or can be static (e.g. standin for later): constant -> apiCall.path
      }
    ],
    apiCalls: [
      //these are in order
      {
        apiCallName: "",
        results: [],
        apiPath: "",
        api: {},
      }
    ]
  },
  {
    isDemo: true,
    apiFlowName: "Comfy Image Upload Test",
    apiFlowType: "debug",
    outputs: [],
    controls: [
      { controlName: "img2img", controlHint: "img", controlType: "image", controlValue: testImageURL, controlLayer: null, controlPath: [ "upload-image", "api", "image" ] },
    ],
    apiCalls: [
      {
        apiCallName: "upload-image",
        results: [], //IDK yet
        host: "device",
        port: 8188,
        apiPath: "/upload/image",
        method: "POST",
        dataFormat: "FORM",
        convertDataImages: true,
        api: {
          image: testImageURL,
        }
      }
    ]
  },
  {
    isDemo: true,
    apiFlowName: "A1111 Upscale Demo",
    apiFlowType: "generative",
    outputs: [
      {
        outputName: "generated-image",
        outputType: "image", //could be images array maybe
        outputResultPath: [ "upscale", "generated-image" ]
      }
    ],
    controls: [
      { controlName: "model", controlType: "static", controlValue:"4x-UltraSharp", controlPath: [ "upscale", "api", "upscaler_1" ], },
      //{ controlName: "model", controlType: "asset", assetName: "A1111 Upscalers", controlPath: [ "upscale", "api", "upscaler_1" ], },
      { controlName: "upscale", controlType: "number", min: 1, max: 8, step:0.125, controlValue:2, controlLayerControlName: "upscale image", controlPath: [ "upscale", "api", "upscaling_resize" ], },
      { controlName: "upscale image", controlHint: "img", controlType: "image", controlValue:"", controlLayer:null, controlPath: [ "upscale", "api", "image" ], },
    ],
    apiCalls: [
      {
        apiCallName: "upscale",
        results: [
          {
            resultName: "generated-image",
            resultType: "base64-image", //could be images array maybe
            resultPath: [ "image" ],
          }
        ],
        host: "device",
        port: 7860,
        apiPath: "/sdapi/v1/extra-single-image",
        method: "POST",
        dataFormat: "JSON",
        convertDataImages: false,
        api: {
          "resize_mode": 0, //0 - upscaling_resize, 1 - _w/_h
          "show_extras_results": true,
          "gfpgan_visibility": 0,
          "codeformer_visibility": 0,
          "codeformer_weight": 0,
          "upscaling_resize": 2,
          "upscaling_resize_w": 512,
          "upscaling_resize_h": 512,
          "upscaling_crop": true,
          "upscaler_1": "4x-UltraSharp",
          "upscaler_2": "None",
          "extras_upscaler_2_visibility": 0,
          "upscale_first": false,
          "image": ""
        }
      }
    ]
  },
  {
    apiFlowName: "A1111 upscalers",
    assetLibraries: [ "A1111 Upscalers" ],
    apiFlowType: "asset",
    outputs: [
      {
        outputName: "upscalers-list",
        outputLibraryName: "A1111 Upscalers",
        outputType: "assets",
        assetMap: [
          { key: "uniqueId", path: [ "name" ] },
          { key: "name", path: [ "name" ] },
          { key: "scale", path: [ "scale" ] },
          //{ key: "modelName", path: [ "model_name" ] }, //this is the name of the base architecture this fine-tune was trained from
          //{ key: "modelPath", path: [ "model_path" ] }, //path on the disk
          //{ key: "modelURL", path: [ "model_url" ] }, //null IDK
        ],
        outputResultPath: [ "get-upscalers", "upscalers-array" ],
      }
    ],
    controls: [],
    apiCalls: [
      {
        apiCallName: "get-upscalers",
        results: [
          {
            resultName: "upscalers-array",
            resultType: "array-object",
            resultPath: [],
          },
        ],
        host: "device",
        port: 7860,
        method: "GET",
        dataFormat: null,
        convertDataImages: false,
        apiPath: "/sdapi/v1/upscalers"
      }
    ],
  },
  {
    apiFlowName: "Comfy Whatnot",
    assetLibraries: [ "Comfy Models", "Comfy ControlNets", "Comfy Samplers", "Comfy Schedulers", "Comfy VAEs", "Comfy UNETs" ],
    apiFlowType: "asset",
    outputs: [
      {
        outputName: "comfy-models-list",
        outputLibraryName: "Comfy Models",
        outputType: "assets",
        assetMap: [
          { key: "uniqueId", path: [] },
          { key: "name", path: [] },
        ],
        outputResultPath: [ "get-object-info", "models-array" ],
      },
      {
        outputName: "comfy-controlnets-list",
        outputLibraryName: "Comfy ControlNets",
        outputType: "assets",
        assetMap: [
          { key: "uniqueId", path: [] },
          { key: "name", path: [] },
        ],
        outputResultPath: [ "get-object-info", "controlnets-array" ],
      },
      {
        outputName: "comfy-samplers",
        outputLibraryName: "Comfy Samplers",
        outputType: "assets",
        assetMap: [
          { key: "uniqueId", path: [] },
          { key: "name", path: [] },
        ],
        outputResultPath: [ "get-object-info", "samplers-array" ],
      },
      {
        outputName: "comfy-schedulers",
        outputLibraryName: "Comfy Schedulers",
        outputType: "assets",
        assetMap: [
          { key: "uniqueId", path: [] },
          { key: "name", path: [] },
        ],
        outputResultPath: [ "get-object-info", "schedulers-array" ],
      },
      {
        outputName: "comfy-schedulers",
        outputLibraryName: "Comfy VAEs",
        outputType: "assets",
        assetMap: [
          { key: "uniqueId", path: [] },
          { key: "name", path: [] },
        ],
        outputResultPath: [ "get-object-info", "vaes-array" ],
      },
      {
        outputName: "comfy-unets",
        outputLibraryName: "Comfy UNETs",
        outputType: "assets",
        assetMap: [
          { key: "uniqueId", path: [] },
          { key: "name", path: [] },
        ],
        outputResultPath: [ "get-object-info", "unets-array" ],
      },
    ],
    controls: [],
    apiCalls: [
      {
        apiCallName: "get-object-info",
        results: [
          {
            resultName: "models-array",
            resultType: "array-string",
            resultPath: [ "CheckpointLoaderSimple", "input", "required", "ckpt_name" ],
          },
          {
            resultName: "controlnets-array",
            resultType: "array-string",
            resultPath: [ "ControlNetLoader", "input", "required", "control_net_name" ],
          },
          {
            resultName: "samplers-array",
            resultType: "array-string",
            resultPath: [ "KSampler", "input", "required", "sampler_name" ],
          },
          {
            resultName: "schedulers-array",
            resultType: "array-string",
            resultPath: [ "KSampler", "input", "required", "scheduler" ],
          },
          {
            resultName: "vaes-array",
            resultType: "array-string",
            resultPath: [ "VAELoader", "input", "required", "vae_name" ],
          },
          {
            resultName: "unets-array",
            resultType: "array-string",
            resultPath: [ "UNETLoader", "input", "required", "unet_name" ],
          },
        ],
        host: "device",
        port: 8188,
        method: "GET",
        dataFormat: null,
        convertDataImages: false,
        apiPath: "/object_info"
      }
    ],
  },
  {
    apiFlowName: "Comfy SD1.5/SDXL txt2img",
    apiFlowType: "generative",
    outputs: [
      {
        outputName: "generated-image",
        outputType: "image", //could be images array maybe
        outputResultPath: [ "view", "generated-image" ]
      }
    ],
    controls: [
      { controlName: "Prompt", controlType: "text", controlValue: "desktop cat", controlPath: [ "sd-prompt", "api", "prompt", "62", "inputs", "text" ], },
      { controlName: "Negative Prompt", controlType: "text", controlValue: "", controlPath: [ "sd-prompt", "api", "prompt", "63", "inputs", "text" ], },
      { controlName: "Steps", controlType: "number", min:1, max:100, step:1, controlValue:4, controlPath: [ "sd-prompt", "api", "prompt", "60", "inputs", "steps" ], },
      { controlName: "CFG", controlType: "number", min:1, max:50, step:0.25, controlValue:1.5, controlPath: [ "sd-prompt", "api", "prompt", "60", "inputs", "cfg" ], },

      { controlName: "Model", controlType: "asset", assetName:"Comfy Models", controlValue:"--no model--", controlPath: [ "sd-prompt", "api", "prompt", "61", "inputs", "ckpt_name" ], },
      /* { controlName: "VAE", controlType: "asset", assetName:"Comfy VAEs", controlValue:"cascade_stage_a.safetensors", controlPath: [ "sd-prompt", "api", "prompt", "29", "inputs", "vae_name" ], }, */

      { controlName: "seed", controlType: "randomInt", min:0, max:999999999, step:1, controlPath: [ "sd-prompt", "api", "prompt", "60", "inputs", "seed" ], },
      { controlName: "width", controlType: "layer-input", layerPath: ["w"], controlValue:1024, controlPath: [ "sd-prompt", "api", "prompt", "66", "inputs", "width" ], },
      { controlName: "height", controlType: "layer-input", layerPath: ["h"], controlValue:1024, controlPath: [ "sd-prompt", "api", "prompt", "66", "inputs", "height" ], },

      { controlName: "UID", controlType: "api-result", resultPath: [ "sd-prompt", "prompt_id" ], controlPath: [ "controlValue" ], controlValue: "to overwrite" },
      //string-compose lets you compose controlValues and constants into a new string
      { controlName: "history-path", controlType: "string-compose", composePaths: [ "/history/", [ "UID", "controlValue" ] ], controlPath: [ "get-filename", "apiPath" ] },
      { controlName: "result-history-filename", controlType: "string-compose", composePaths: [ "", [ "UID", "controlValue" ] ], controlPath: [ "get-filename", "results", 0, "resultPath", 0 ] },
      { controlName: "result-history-subfolder", controlType: "string-compose", composePaths: [ "", [ "UID", "controlValue" ] ], controlPath: [ "get-filename", "results", 1, "resultPath", 0 ] },
      { controlName: "filename", controlType: "api-result", resultPath: [ "get-filename", "image-filename" ], controlPath: [ "controlValue" ], controlValue: "to overwrite with filename" },
      //{ controlName: "filefolder", controlType: "api-result", resultPath: [ "get-filename", "image-subfolder" ], controlPath: [ "controlValue" ], controlValue: "to overwrite with filefolder" },
      
      { controlName: "view-filename", controlType: "string-compose", composePaths: [ "/view?filename=", [ "filename", "controlValue" ], "&subfolder=&type=output&rand=0.0923485734985" ], controlPath: [ "view", "apiPath" ] },
    ],
    apiCalls: [
      {
        apiCallName: "sd-prompt",
        results: [
          {
            resultName: "prompt_id",
            resultType: "string",
            resultPath: ["prompt_id"],
          },
        ],
        host: "device",
        port: 8188,
        apiPath: "/prompt",
        method: "POST",
        dataFormat: "JSON",
        convertDataImages: false,
        api: {
          prompt: {
            "60": {
              "inputs": {
                "seed": 249619404060710,
                "steps": 4,
                "cfg": 1.5,
                "sampler_name": "dpmpp_sde",
                "scheduler": "normal",
                "denoise": 1,
                "model": [
                  "61",
                  0
                ],
                "positive": [
                  "62",
                  0
                ],
                "negative": [
                  "63",
                  0
                ],
                "latent_image": [
                  "66",
                  0
                ]
              },
              "class_type": "KSampler",
              "_meta": {
                "title": "KSampler"
              }
            },
            "61": {
              "inputs": {
                "ckpt_name": "SDXL-Juggernaut-Lightning-4S.DPMppSDE.832x1216.CFG1-2.safetensors"
              },
              "class_type": "CheckpointLoaderSimple",
              "_meta": {
                "title": "Load Checkpoint"
              }
            },
            "62": {
              "inputs": {
                "text": "test",
                "clip": [
                  "61",
                  1
                ]
              },
              "class_type": "CLIPTextEncode",
              "_meta": {
                "title": "CLIP Text Encode (Prompt)"
              }
            },
            "63": {
              "inputs": {
                "text": "",
                "clip": [
                  "61",
                  1
                ]
              },
              "class_type": "CLIPTextEncode",
              "_meta": {
                "title": "CLIP Text Encode (Prompt)"
              }
            },
            "64": {
              "inputs": {
                "samples": [
                  "60",
                  0
                ],
                "vae": [
                  "61",
                  2
                ]
              },
              "class_type": "VAEDecode",
              "_meta": {
                "title": "VAE Decode"
              }
            },
            "65": {
              "inputs": {
                "filename_prefix": "ComfyUI",
                "images": [
                  "64",
                  0
                ]
              },
              "class_type": "SaveImage",
              "_meta": {
                "title": "Save Image"
              }
            },
            "66": {
              "inputs": {
                "width": 1024,
                "height": 1024,
                "batch_size": 1
              },
              "class_type": "EmptyLatentImage",
              "_meta": {
                "title": "Empty Latent Image"
              }
            }
          }
        },
      },
      {
        retryOnEmpty: true,
        apiCallName: "get-filename",
        results: [
          {
            resultName: "image-filename",
            resultType: "string",
            resultPath: [ "{UID for filename}", "outputs", 65, "images", 0, "filename" ],
          },
          {
            resultName: "image-subfolder",
            resultType: "string",
            resultPath: [ "{UID for subfolder}", "outputs", 65, "images", 0, "subfolder" ],
          },
        ],
        host: "device",
        port: 8188,
        method: "GET",
        dataFormat: null,
        convertDataImages: false,
        apiPath: "/history/{UID}"
      },
      {
        apiCallName: "view",
        results: [
          {
            resultName: "generated-image",
            resultType: "file-image",
            resultPath: "file"
          }
        ],
        host: "device",
        port: 8188,
        method: "GET",
        dataFormat: null,
        convertDataImages: false,
        apiPath: "/view?filename={FILENAME}"
      }
    ]
  },
  {
    apiFlowName: "Comfy SD1.5/SDXL img2img",
    apiFlowType: "generative",
    outputs: [
      {
        outputName: "generated-image",
        outputType: "image", //could be images array maybe
        outputResultPath: [ "view", "generated-image" ]
      }
    ],
    controls: [
      { controlName: "img2img", controlHint: "i2i", controlType: "image", controlValue: "", controlLayer: null, controlPath: [ "upload-image", "api", "image" ] },

      { controlName: "i2i-image-filename", controlType: "api-result", resultPath: [ "upload-image", "image-filename" ], controlPath: [ "controlValue" ], controlValue: "to overwrite with uploadname" },

      { controlName: "Prompt", controlType: "text", controlValue: "desktop cat", controlPath: [ "sd-prompt", "api", "prompt", "62", "inputs", "text" ], },
      { controlName: "Negative Prompt", controlType: "text", controlValue: "", controlPath: [ "sd-prompt", "api", "prompt", "63", "inputs", "text" ], },
      { controlName: "Steps", controlType: "number", min:1, max:100, step:1, controlValue:4, controlPath: [ "sd-prompt", "api", "prompt", "60", "inputs", "steps" ], },
      { controlName: "CFG", controlType: "number", min:1, max:50, step:0.25, controlValue:1.5, controlPath: [ "sd-prompt", "api", "prompt", "60", "inputs", "cfg" ], },
      { controlName: "Denoise", controlType: "number", min:0, max:1, step:0.01, controlValue:0.5, controlPath: [ "sd-prompt", "api", "prompt", "60", "inputs", "denoise" ], },

      { controlName: "Model", controlType: "asset", assetName:"Comfy Models", controlValue:"--no model--", controlPath: [ "sd-prompt", "api", "prompt", "61", "inputs", "ckpt_name" ], },
      /* { controlName: "VAE", controlType: "asset", assetName:"Comfy VAEs", controlValue:"cascade_stage_a.safetensors", controlPath: [ "sd-prompt", "api", "prompt", "29", "inputs", "vae_name" ], }, */

      { controlName: "seed", controlType: "randomInt", min:0, max:999999999, step:1, controlPath: [ "sd-prompt", "api", "prompt", "60", "inputs", "seed" ], },
      //{ controlName: "width", controlType: "layer-input", layerPath: ["w"], controlValue:1024, controlPath: [ "sd-prompt", "api", "prompt", "66", "inputs", "width" ], },
      //{ controlName: "height", controlType: "layer-input", layerPath: ["h"], controlValue:1024, controlPath: [ "sd-prompt", "api", "prompt", "66", "inputs", "height" ], },
      { controlName: "prompt-i2i-filename", controlType: "string-compose", composePaths: [ "", [ "i2i-image-filename", "controlValue" ] ], controlPath: [ "sd-prompt", "api", "prompt", "67", "inputs", "image" ], },

      { controlName: "UID", controlType: "api-result", resultPath: [ "sd-prompt", "prompt_id" ], controlPath: [ "controlValue" ], controlValue: "to overwrite" },
      //string-compose lets you compose controlValues and constants into a new string
      { controlName: "history-path", controlType: "string-compose", composePaths: [ "/history/", [ "UID", "controlValue" ] ], controlPath: [ "get-filename", "apiPath" ] },
      { controlName: "result-history-filename", controlType: "string-compose", composePaths: [ "", [ "UID", "controlValue" ] ], controlPath: [ "get-filename", "results", 0, "resultPath", 0 ] },
      { controlName: "result-history-subfolder", controlType: "string-compose", composePaths: [ "", [ "UID", "controlValue" ] ], controlPath: [ "get-filename", "results", 1, "resultPath", 0 ] },
      { controlName: "filename", controlType: "api-result", resultPath: [ "get-filename", "image-filename" ], controlPath: [ "controlValue" ], controlValue: "to overwrite with filename" },
      //{ controlName: "filefolder", controlType: "api-result", resultPath: [ "get-filename", "image-subfolder" ], controlPath: [ "controlValue" ], controlValue: "to overwrite with filefolder" },
      
      { controlName: "view-filename", controlType: "string-compose", composePaths: [ "/view?filename=", [ "filename", "controlValue" ], "&subfolder=&type=output&rand=0.0923485734985" ], controlPath: [ "view", "apiPath" ] },
    ],
    apiCalls: [
      {
        apiCallName: "upload-image",
        results: [
          {
            resultName: "image-filename",
            resultType: "string",
            resultPath: [ "name" ], //"subfolder","type"
          }
        ],
        host: "device",
        port: 8188,
        apiPath: "/upload/image",
        method: "POST",
        dataFormat: "FORM",
        convertDataImages: true,
        api: {
          image: "",
        }
      },
      {
        apiCallName: "sd-prompt",
        results: [
          {
            resultName: "prompt_id",
            resultType: "string",
            resultPath: ["prompt_id"],
          },
        ],
        host: "device",
        port: 8188,
        apiPath: "/prompt",
        method: "POST",
        dataFormat: "JSON",
        convertDataImages: false,
        api: {
          prompt: {
            "60": {
              "inputs": {
                "seed": 1037991131309544,
                "steps": 4,
                "cfg": 1.5,
                "sampler_name": "dpmpp_sde",
                "scheduler": "normal",
                "denoise": 0.62,
                "model": [
                  "61",
                  0
                ],
                "positive": [
                  "62",
                  0
                ],
                "negative": [
                  "63",
                  0
                ],
                "latent_image": [
                  "68",
                  0
                ]
              },
              "class_type": "KSampler",
              "_meta": {
                "title": "KSampler"
              }
            },
            "61": {
              "inputs": {
                "ckpt_name": "SDXL-Juggernaut-Lightning-4S.DPMppSDE.832x1216.CFG1-2.safetensors"
              },
              "class_type": "CheckpointLoaderSimple",
              "_meta": {
                "title": "Load Checkpoint"
              }
            },
            "62": {
              "inputs": {
                "text": "test",
                "clip": [
                  "61",
                  1
                ]
              },
              "class_type": "CLIPTextEncode",
              "_meta": {
                "title": "CLIP Text Encode (Prompt)"
              }
            },
            "63": {
              "inputs": {
                "text": "",
                "clip": [
                  "61",
                  1
                ]
              },
              "class_type": "CLIPTextEncode",
              "_meta": {
                "title": "CLIP Text Encode (Prompt)"
              }
            },
            "64": {
              "inputs": {
                "samples": [
                  "60",
                  0
                ],
                "vae": [
                  "61",
                  2
                ]
              },
              "class_type": "VAEDecode",
              "_meta": {
                "title": "VAE Decode"
              }
            },
            "65": {
              "inputs": {
                "filename_prefix": "ComfyUI",
                "images": [
                  "64",
                  0
                ]
              },
              "class_type": "SaveImage",
              "_meta": {
                "title": "Save Image"
              }
            },
            "67": {
              "inputs": {
                "image": "00008-3677720763.png",
                "upload": "image"
              },
              "class_type": "LoadImage",
              "_meta": {
                "title": "Load Image"
              }
            },
            "68": {
              "inputs": {
                "pixels": [
                  "67",
                  0
                ],
                "vae": [
                  "61",
                  2
                ]
              },
              "class_type": "VAEEncode",
              "_meta": {
                "title": "VAE Encode"
              }
            }
          }
        },
      },
      {
        retryOnEmpty: true,
        apiCallName: "get-filename",
        results: [
          {
            resultName: "image-filename",
            resultType: "string",
            resultPath: [ "{UID for filename}", "outputs", 65, "images", 0, "filename" ],
          },
          {
            resultName: "image-subfolder",
            resultType: "string",
            resultPath: [ "{UID for subfolder}", "outputs", 65, "images", 0, "subfolder" ],
          },
        ],
        host: "device",
        port: 8188,
        method: "GET",
        dataFormat: null,
        convertDataImages: false,
        apiPath: "/history/{UID}"
      },
      {
        apiCallName: "view",
        results: [
          {
            resultName: "generated-image",
            resultType: "file-image",
            resultPath: "file"
          }
        ],
        host: "device",
        port: 8188,
        method: "GET",
        dataFormat: null,
        convertDataImages: false,
        apiPath: "/view?filename={FILENAME}"
      }
    ]
  },
  {
    apiFlowName: "Comfy SC Test",
    apiFlowType: "generative",
    outputs: [
      {
        outputName: "generated-image",
        outputType: "image", //could be images array maybe
        outputResultPath: [ "view", "generated-image" ]
      }
    ],
    controls: [
      { controlName: "Prompt", controlType: "text", controlValue: "desktop cat", controlPath: [ "sc-prompt", "api", "prompt", "6", "inputs", "text" ], },
      { controlName: "Negative Prompt", controlType: "text", controlValue: "", controlPath: [ "sc-prompt", "api", "prompt", "7", "inputs", "text" ], },
      { controlName: "C Steps", controlType: "number", min:1, max:100, step:1, controlValue:4, controlPath: [ "sc-prompt", "api", "prompt", "3", "inputs", "steps" ], },
      { controlName: "C CFG", controlType: "number", min:1, max:50, step:0.25, controlValue:1.5, controlPath: [ "sc-prompt", "api", "prompt", "3", "inputs", "cfg" ], },
      { controlName: "B Steps", controlType: "number", min:1, max:100, step:1, controlValue:2, controlPath: [ "sc-prompt", "api", "prompt", "33", "inputs", "steps" ], },

      { controlName: "C Model", controlType: "asset", assetName:"Comfy UNETs", controlValue:"cascade_stage_c_bf16.safetensors", controlPath: [ "sc-prompt", "api", "prompt", "30", "inputs", "unet_name" ], },
      { controlName: "B Model", controlType: "asset", assetName:"Comfy UNETs", controlValue:"cascade_stage_b_lite_bf16.safetensors", controlPath: [ "sc-prompt", "api", "prompt", "32", "inputs", "unet_name" ], },
      { controlName: "VAE", controlType: "asset", assetName:"Comfy VAEs", controlValue:"cascade_stage_a.safetensors", controlPath: [ "sc-prompt", "api", "prompt", "29", "inputs", "vae_name" ], },

      { controlName: "seed", controlType: "randomInt", min:0, max:999999999, step:1, controlPath: [ "sc-prompt", "api", "prompt", "3", "inputs", "seed" ], },
      { controlName: "width", controlType: "layer-input", layerPath: ["w"], controlValue:1024, controlPath: [ "sc-prompt", "api", "prompt", "34", "inputs", "width" ], },
      { controlName: "height", controlType: "layer-input", layerPath: ["h"], controlValue:1024, controlPath: [ "sc-prompt", "api", "prompt", "34", "inputs", "height" ], },

      { controlName: "UID", controlType: "api-result", resultPath: [ "sc-prompt", "prompt_id" ], controlPath: [ "controlValue" ], controlValue: "to overwrite" },
      //string-compose lets you compose controlValues and constants into a new string
      { controlName: "history-path", controlType: "string-compose", composePaths: [ "/history/", [ "UID", "controlValue" ] ], controlPath: [ "get-filename", "apiPath" ] },
      { controlName: "result-history-filename", controlType: "string-compose", composePaths: [ "", [ "UID", "controlValue" ] ], controlPath: [ "get-filename", "results", 0, "resultPath", 0 ] },
      { controlName: "result-history-subfolder", controlType: "string-compose", composePaths: [ "", [ "UID", "controlValue" ] ], controlPath: [ "get-filename", "results", 1, "resultPath", 0 ] },
      { controlName: "filename", controlType: "api-result", resultPath: [ "get-filename", "image-filename" ], controlPath: [ "controlValue" ], controlValue: "to overwrite with filename" },
      { controlName: "filefolder", controlType: "api-result", resultPath: [ "get-filename", "image-subfolder" ], controlPath: [ "controlValue" ], controlValue: "to overwrite with filefolder" },
      //&subfolder=wuer&type=output
      { controlName: "view-filename", controlType: "string-compose", composePaths: [ "/view?filename=", [ "filename", "controlValue" ], "&subfolder=", [ "filefolder", "controlValue" ], "&type=output&rand=0.0923485734985" ], controlPath: [ "view", "apiPath" ] },
      //{ controlName: "view-filename", controlType: "string-compose", composePaths: [ "/view?filename=", [ "filename", "controlValue" ], "&subfolder=&type=output&rand=0.0923485734985" ], controlPath: [ "view", "apiPath" ] },
    ],
    apiCalls: [
      {
        apiCallName: "sc-prompt",
        results: [
          {
            resultName: "prompt_id",
            resultType: "string",
            resultPath: ["prompt_id"],
          },
        ],
        host: "device",
        port: 8188,
        apiPath: "/prompt",
        method: "POST",
        dataFormat: "JSON",
        convertDataImages: false,
        api: { prompt: {
          "3": {
            "inputs": {
              "seed": 750887496150267,
              "steps": 4,
              "cfg": 1.5,
              "sampler_name": "ddpm",
              "scheduler": "simple",
              "denoise": 1,
              "model": [
                "59",
                0
              ],
              "positive": [
                "6",
                0
              ],
              "negative": [
                "7",
                0
              ],
              "latent_image": [
                "34",
                0
              ]
            },
            "class_type": "KSampler",
            "_meta": {
              "title": "KSampler"
            }
          },
          "6": {
            "inputs": {
              "text": "desktop cat",
              "clip": [
                "37",
                0
              ]
            },
            "class_type": "CLIPTextEncode",
            "_meta": {
              "title": "CLIP Text Encode (Prompt)"
            }
          },
          "7": {
            "inputs": {
              "text": "",
              "clip": [
                "37",
                0
              ]
            },
            "class_type": "CLIPTextEncode",
            "_meta": {
              "title": "CLIP Text Encode (Prompt)"
            }
          },
          "8": {
            "inputs": {
              "samples": [
                "33",
                0
              ],
              "vae": [
                "29",
                0
              ]
            },
            "class_type": "VAEDecode",
            "_meta": {
              "title": "VAE Decode"
            }
          },
          "9": {
            "inputs": {
              "filename_prefix": "wuer/ComfyUI",
              "images": [
                "8",
                0
              ]
            },
            "class_type": "SaveImage",
            "_meta": {
              "title": "Save Image"
            }
          },
          "29": {
            "inputs": {
              "vae_name": "cascade_stage_a.safetensors"
            },
            "class_type": "VAELoader",
            "_meta": {
              "title": "Load VAE"
            }
          },
          "30": {
            "inputs": {
              "unet_name": "cascade_stage_c_bf16.safetensors"
            },
            "class_type": "UNETLoader",
            "_meta": {
              "title": "UNETLoader"
            }
          },
          "32": {
            "inputs": {
              "unet_name": "cascade_stage_b_lite_bf16.safetensors"
            },
            "class_type": "UNETLoader",
            "_meta": {
              "title": "UNETLoader"
            }
          },
          "33": {
            "inputs": {
              "seed": 750887496150267,
              "steps": 2,
              "cfg": 1,
              "sampler_name": "ddpm",
              "scheduler": "simple",
              "denoise": 1,
              "model": [
                "32",
                0
              ],
              "positive": [
                "36",
                0
              ],
              "negative": [
                "40",
                0
              ],
              "latent_image": [
                "34",
                1
              ]
            },
            "class_type": "KSampler",
            "_meta": {
              "title": "KSampler"
            }
          },
          "34": {
            "inputs": {
              "width": 1024,
              "height": 1024,
              "compression": 42,
              "batch_size": 1
            },
            "class_type": "StableCascade_EmptyLatentImage",
            "_meta": {
              "title": "StableCascade_EmptyLatentImage"
            }
          },
          "36": {
            "inputs": {
              "conditioning": [
                "40",
                0
              ],
              "stage_c": [
                "3",
                0
              ]
            },
            "class_type": "StableCascade_StageB_Conditioning",
            "_meta": {
              "title": "StableCascade_StageB_Conditioning"
            }
          },
          "37": {
            "inputs": {
              "clip_name": "cascade_clip.safetensors",
              "type": "stable_cascade"
            },
            "class_type": "CLIPLoader",
            "_meta": {
              "title": "Load CLIP"
            }
          },
          "40": {
            "inputs": {
              "conditioning": [
                "6",
                0
              ]
            },
            "class_type": "ConditioningZeroOut",
            "_meta": {
              "title": "ConditioningZeroOut"
            }
          },
          "59": {
            "inputs": {
              "shift": 2,
              "model": [
                "30",
                0
              ]
            },
            "class_type": "ModelSamplingStableCascade",
            "_meta": {
              "title": "ModelSamplingStableCascade"
            }
          }
        }
      } },
      {
        retryOnEmpty: true,
        apiCallName: "get-filename",
        results: [
          {
            resultName: "image-filename",
            resultType: "string",
            resultPath: [ "{UID for filename}", "outputs", 9, "images", 0, "filename" ],
          },
          {
            resultName: "image-subfolder",
            resultType: "string",
            resultPath: [ "{UID for subfolder}", "outputs", 9, "images", 0, "subfolder" ],
          },
        ],
        host: "device",
        port: 8188,
        method: "GET",
        dataFormat: null,
        convertDataImages: false,
        apiPath: "/history/{UID}"
      },
      {
        apiCallName: "view",
        results: [
          {
            resultName: "generated-image",
            resultType: "file-image",
            resultPath: "file"
          }
        ],
        host: "device",
        port: 8188,
        method: "GET",
        dataFormat: null,
        convertDataImages: false,
        apiPath: "/view?filename={FILENAME}"
      }
    ]
  },
  {
    apiFlowName: "A1111 Layer to Lineart Demo",
    apiFlowType: "generative",
    outputs: [
      {
        outputName: "generated-image",
        outputType: "image", //could be images array maybe
        outputResultPath: [ "cn", "generated-image" ]
      }
    ],
    controls: [
      { controlName: "module", controlType: "static", controlValue:"lineart_anime_denoise", controlPath: [ "cn", "api", "controlnet_module" ], },
      { controlName: "threshold a", controlType: "number", min:1, max:255, step:1, controlValue:64, controlPath: [ "cn", "api", "controlnet_threshold_a" ], },
      { controlName: "threshold b", controlType: "number", min:1, max:255, step:1, controlValue:64, controlPath: [ "cn", "api", "controlnet_threshold_b" ], },
      { controlName: "controlnet", controlHint: "CN", controlType: "image", controlValue:"", controlLayer:null, controlPath: [ "cn", "api", "controlnet_input_images", 0 ], },
      { controlName: "resolution", controlType: "layer-input", layerPath: ["w"], controlValue:1024, controlLayerControlName: "controlnet", controlPath: [ "cn", "api", "controlnet_processor_res" ], },
    ],
    apiCalls: [
      {
        apiCallName: "cn",
        results: [
          {
            resultName: "generated-image",
            resultType: "base64-image", //could be images array maybe
            resultPath: [ "images", 0 ],
          }
        ],
        host: "device",
        port: 7860,
        apiPath: "/controlnet/detect",
        method: "POST",
        dataFormat: "JSON",
        convertDataImages: false,
        api: {
          "controlnet_module": "none",
          "controlnet_input_images": [ "" ],
          "controlnet_processor_res": 512,
          "controlnet_threshold_a": 64,
          "controlnet_threshold_b": 64,
          "low_vram": false
        }
      }
    ]
  },
  {
    apiFlowName: "A1111 Lightning Demo img2img Mini",
    apiFlowType: "generative",
    outputs: [
      {
        outputName: "generated-image",
        outputType: "image", //could be images array maybe
        outputResultPath: [ "i2i", "generated-image" ]
      }
    ],
    controls: [
      { controlName: "prompt", controlType: "text", controlValue: "desktop cat", controlPath: [ "i2i", "api", "prompt" ], },
      { controlName: "negative-prompt", controlType: "text", controlValue: "", controlPath: [ "i2i", "api", "negative_prompt" ], },

      { controlName: "apiPath", controlType: "static", controlValue: "/sdapi/v1/img2img", controlPath: [ "i2i", "apiPath" ], },
      { controlName: "seed", controlType: "randomInt", min:0, max:999999999, step:1, controlPath: [ "i2i", "api", "seed" ], },
      { controlName: "sampler", controlType: "static", controlValue:"DPM++ SDE", controlPath: [ "i2i", "api", "sampler_name" ], },
      { controlName: "denoise", controlType: "number", min:0, max:1, step:0.01, controlValue:0.75, controlPath: [ "i2i", "api", "denoising_strength" ], },
      { controlName: "steps", controlType: "number", min:1, max:100, step:1, controlValue:4, controlPath: [ "i2i", "api", "steps" ], },
      { controlName: "cfg", controlType: "number", controlValue:1.5, min:0, max: 20, step:0.5, controlPath: [ "i2i", "api", "cfg_scale" ], },
      { controlName: "width", controlType: "layer-input", layerPath: ["w"], controlValue:1024, controlLayerControlName: "img2img", controlPath: [ "i2i", "api", "width" ], },
      { controlName: "height", controlType: "layer-input", layerPath: ["h"], controlValue:1024, controlLayerControlName: "img2img", controlPath: [ "i2i", "api", "height" ], },

      { controlName: "img2img", controlHint: "i2i", controlType: "image", controlValue:"", controlLayer:null, controlPath: [ "i2i", "api", "init_images", 0 ], },
    ],
    apiCalls: [
      {
        apiCallName: "i2i",
        results: [
          {
            resultName: "generated-image",
            resultType: "base64-image", //could be images array maybe
            resultPath: [ "images", 0 ],
          }
        ],
        host: "device",
        port: 7860,
        apiPath: "/sdapi/v1/img2img",
        method: "POST",
        dataFormat: "JSON",
        convertDataImages: false,
        api: {
          "denoising_strength": 0.74,
          "image_cfg_scale": 1.5,

          "init_images": [ "" ],

          "initial_noise_multiplier": 1,
          "inpaint_full_res": 0,
          "inpaint_full_res_padding": 32,
          "inpainting_fill": 1,
          "inpainting_mask_invert": 0,
          "mask_blur": 4,
          "mask_blur_x": 4,
          "mask_blur_y": 4,

          "batch_size": 1,
          "cfg_scale": 1.5,
          "disable_extra_networks": false,
          "do_not_save_grid": false,
          "do_not_save_samples": false,
          "enable_hr": false,
          "height": 1024,
          "negative_prompt": "",
          "prompt": "desktop cat",
          "restore_faces": false,
          /* "s_churn": 0,
          "s_min_uncond": 0,
          "s_noise": 1,
          "s_tmax": null,
          "s_tmin": 0, */
          "sampler_name": "DPM++ SDE",
          "script_name": null,
          "seed": 3718586839,
          "steps": 4,
          "tiling": false,
          "width": 1024,
        }
      }
    ]
  },
  {
    apiFlowName: "A1111 Lightning Demo txt2img Mini",
    apiFlowType: "generative",
    outputs: [
      {
        outputName: "generated-image",
        outputType: "image",
        outputResultPath: [ "t2i", "generated-image" ]
      }
    ],
    controls: [
      { controlName: "prompt", controlType: "text", controlValue: "desktop cat", controlPath: [ "t2i", "api", "prompt" ], },
      { controlName: "negative-prompt", controlType: "text", controlValue: "", controlPath: [ "i2i", "api", "negative_prompt" ], },

      { controlName: "apiPath", controlType: "static", controlValue: "/sdapi/v1/txt2img", controlPath: [ "t2i", "apiPath" ], },
      { controlName: "seed", controlType: "randomInt", min:0, max:999999999, step:1, controlPath: [ "t2i", "api", "seed" ], },
      { controlName: "sampler", controlType: "static", controlValue:"DPM++ SDE", controlPath: [ "t2i", "api", "sampler_name" ], },
      { controlName: "steps", controlType: "number", min:1, max:100, step:1, controlValue:4, controlPath: [ "t2i", "api", "steps" ], },
      { controlName: "cfg", controlType: "number", controlValue:1.5, min:1, max: 20, step:0.5, controlPath: [ "t2i", "api", "cfg_scale" ], },
      { controlName: "width", controlType: "layer-input", layerPath: ["w"], controlValue:1024, controlPath: [ "t2i", "api", "width" ], },
      { controlName: "height", controlType: "layer-input", layerPath: ["h"], controlValue:1024, controlPath: [ "t2i", "api", "height" ], },
    ],
    apiCalls: [
      {
        apiCallName: "t2i",
        results: [
          {
            resultName: "generated-image",
            resultType: "base64-image",
            resultPath: [ "images", 0 ],
          }
        ],
        host: "device",
        port: 7860,
        apiPath: "/sdapi/v1/txt2img",
        method: "POST",
        dataFormat: "JSON",
        convertDataImages: false,
        api: {
          "batch_size": 1,
          "cfg_scale": 7,
          "disable_extra_networks": false,
          "do_not_save_grid": false,
          "do_not_save_samples": false,
          "enable_hr": false,
          "height": 1024,
          "negative_prompt": "",
          "prompt": "desktop cat",
          "restore_faces": false,
          "s_churn": 0,
          "s_min_uncond": 0,
          "s_noise": 1,
          "s_tmax": null,
          "s_tmin": 0,
          "sampler_name": "DPM++ 3M SDE Exponential",
          "script_name": null,
          "seed": 3718586839,
          "steps": 50,
          "tiling": false,
          "width": 1024,
        }
      },
    ]
  },
  {
    isDemo: true,
    //just replicate t2i functionality: prompt -> lightning
    apiFlowName: "A1111 Lightning Demo",
    apiFlowType: "generative",
    outputs: [
      {
        outputName: "generated-image",
        outputType: "image", //could be images array maybe
        outputResultPath: [ "t2i", "generated-image" ]
      }
    ],
    controls: [
      {
        controlName: "prompt",
        controlType: "text",
        controlValue: "desktop cat",
        controlPath: [ "t2i", "api", "prompt" ],
      },
      { controlName: "apiPath", controlType: "static", controlValue: "/sdapi/v1/txt2img", controlPath: [ "t2i", "apiPath" ], },
      { controlName: "seed", controlType: "randomInt", controlPath: [ "t2i", "api", "seed" ], },
      { controlName: "sampler", controlType: "static", controlValue:"DPM++ SDE", controlPath: [ "t2i", "api", "sampler_name" ], },
      { controlName: "steps", controlType: "static", controlValue:4, controlPath: [ "t2i", "api", "steps" ], },
      { controlName: "cfg", controlType: "static", controlValue:1.5, controlPath: [ "t2i", "api", "cfg_scale" ], },
      { controlName: "width", controlType: "static", controlValue:1024, controlPath: [ "t2i", "api", "width" ], },
      { controlName: "height", controlType: "static", controlValue:1024, controlPath: [ "t2i", "api", "height" ], },
    ],
    apiCalls: [
      {
        apiCallName: "t2i",
        results: [
          {
            resultName: "generated-image",
            resultType: "base64-image", //could be images array maybe
            resultPath: [ "images", 0 ],
          }
        ],
        host: "device",
        port: 7860,
        apiPath: "/sdapi/v1/txt2img",
        method: "POST",
        dataFormat: "JSON",
        convertDataImages: false,
        api: {
          "alwayson_scripts": {
            "ControlNet": {
              "args": [
                {
                  "advanced_weighting": null,
                  "batch_images": "",
                  "control_mode": "Balanced",
                  "enabled": false,
                  "guidance_end": 1,
                  "guidance_start": 0,
                  "hr_option": "Both",
                  "image": null,
                  "inpaint_crop_input_image": false,
                  "input_mode": "simple",
                  "is_ui": true,
                  "loopback": false,
                  "low_vram": false,
                  "model": "None",
                  "module": "none",
                  "output_dir": "",
                  "pixel_perfect": false,
                  "processor_res": -1,
                  "resize_mode": "Crop and Resize",
                  "save_detected_map": true,
                  "threshold_a": -1,
                  "threshold_b": -1,
                  "weight": 1
                }
              ]
            }
          },
          "batch_size": 1,
          "cfg_scale": 7,
          "comments": {},
          "disable_extra_networks": false,
          "do_not_save_grid": false,
          "do_not_save_samples": false,
          "enable_hr": false,
          "height": 1024,
          "hr_negative_prompt": "",
          "hr_prompt": "",
          "hr_resize_x": 0,
          "hr_resize_y": 0,
          "hr_scale": 2,
          "hr_second_pass_steps": 0,
          "hr_upscaler": "Latent",
          "n_iter": 1,
          "negative_prompt": "",
          "override_settings": {},
          "override_settings_restore_afterwards": true,
          "prompt": "desktop cat",
          "restore_faces": false,
          "s_churn": 0,
          "s_min_uncond": 0,
          "s_noise": 1,
          "s_tmax": null,
          "s_tmin": 0,
          "sampler_name": "DPM++ 3M SDE Exponential",
          "script_args": [],
          "script_name": null,
          "seed": 3718586839,
          "seed_enable_extras": true,
          "seed_resize_from_h": -1,
          "seed_resize_from_w": -1,
          "steps": 50,
          "styles": [],
          "subseed": 4087077444,
          "subseed_strength": 0,
          "tiling": false,
          "width": 1024,
        }
      },
    ]
  },
]

setup();