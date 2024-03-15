/* Working Proof of Concept:

    What next?
    Iterate! Don't optimize!
    
  The POC is done. It's actually totally usable.
  What's next? I have a list of alpha features.

  Next, I should start using it.
  The color wheel is usable, if not perfect. Have eyedropper too, no blend tho.
  Next:

    Temporary VR camera case for testing battery, code to auto-start, guaranteed on/off usability in field
    
    UI:
    - icons (start temp, don't optimize, iterate)
    - brush controls
    - gen controls from 1 solitary proto JSON flow instance
    - layer drag+drop groups (for visible->img2img)
    - layers scroll
    - layer hookup to top of screen (layer -> control only, so no scroll while linking)
      : handle link behavior on scroll
    - make JSON flow reasonably real on back of A1111 api
      : gen history
    - No comfyui yet
    - asset browser for some hard-coded brush configs, gen presets, models, loras, *?
      : brushes pencil and brushpen
    - brush s/o/b preview (On GPU! Need pipeline practice and framebuffer code.)

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

let layersAddedCount = -1;
async function addCanvasLayer( layerType, lw=1024, lh=1024, nextSibling ) {
  
  //layerType === "paint" | "paint-preview" | "generative"

  let tl =  [W/2-lw/2,H/2-lh/2,1],
   tr = [W/2+lw/2,H/2-lh/2,1],
   bl = [W/2-lw/2,H/2+lh/2,1],
   br = [W/2+lw/2,H/2+lh/2,1];

  if( layersStack.layers.length > 0 ) {
    const { topLeft, topRight, bottomLeft, bottomRight } = layersStack.layers[ 0 ];
    tl = [...topLeft];
    tr = [...topRight];
    bl = [...bottomLeft];
    br = [...bottomRight];
  }

  //create the back-end layer info
  console.error( "On gen layer make, pull current / last used / first api flow controls" );
  const newLayer = {
    //layerOrder: layersStack.layers.length, //not implemented
    layerType,
    layerName: "Layer " + (++layersAddedCount),

    visible: true,
    setVisibility: null,
    opacity:1.0,
    setOpacity: null,

    //linkNodes: [],
    
    //changes IFF you change it
    generativeSettings: {
      apiFlowName: "A1111 Lightning Demo txt2img Mini"
    },
    
    nodeUplinks: new Set(),
    generativeControls: {},

    w:lw, h:lh,
    topLeft:tl,
    topRight:tr,
    bottomLeft:bl,
    bottomRight:br,

    canvas: document.createElement("canvas"),
    context: null,

    maskCanvas: document.createElement( "canvas" ),
    maskContext: null,
    maskInitialized: false,

    glTexture: null,
    textureChanged: false,
    textureChangedRect: {x:0,y:0,w:lw,h:lh},

    glMask: null,
    maskChanged: false,
    maskChangedRect: {x:0,y:0,w:lw,h:lh},

    layerButton: null,
    mergeButton: null,

  }
  newLayer.canvas.width = lw;
  newLayer.canvas.height = lh;
  newLayer.context = newLayer.canvas.getContext( "2d" );

  newLayer.maskCanvas.width = lw;
  newLayer.maskCanvas.height = lh;
  newLayer.maskContext = newLayer.maskCanvas.getContext( "2d" );
  //opacify the mask
  newLayer.maskContext.fillStyle = "rgb(255,255,255)";
  newLayer.maskContext.fillRect( 0,0,lw,lh );

  if( nextSibling ) {
    const index = layersStack.layers.indexOf( nextSibling );
    layersStack.layers.splice( index+1, 0, newLayer );
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

  let layerSibling,
    layerButton;
  if( layerType === "paint" || layerType === "generative" ) {
    //create the layer button
    layerButton = document.createElement( "div" );
    layerButton.classList.add( "layer-button", "expanded" );
    layerButton.appendChild( newLayer.canvas );
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
            selectLayer( newLayer );
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
            //adding the new layer inherently adds the undo component
            const copy = await addCanvasLayer( layerType, lw, lh, newLayer )
            //by altering the properties without registering a new undo, the creation undo is a copy
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

    //the move button
    {
      const moveButton = document.createElement( "div" );
      moveButton.classList.add( "layer-move-button", "layer-ui-button", "animated", "unimplemented"  );
      UI.registerElement(
        moveButton,
        {
          ondrag: ({ rect, start, current, ending, starting, element }) => {
            if( starting ) {
              uiContainer.appendChild( layerButton );
              layerButton.style.position = "absolute";
            }
            layerButton.style.left = `calc( ${current.x}px - 1.5rem )`;
            layerButton.style.top = `calc( ${current.y}px - 3.5rem )`;
            if( ending ) {
              document.querySelector( "#layers-column" ).appendChild( layerButton );
              layerButton.style = "";
            }
          },
        },
        { tooltip: [ "!unimplemented! Reorganize Layer", "to-left", "vertical-center" ], zIndex:1000 },
      )
      layerButton.appendChild( moveButton );
    }

    //the layer name
    {
      const layerName = document.createElement( "div" );
      layerName.classList.add( "layer-name", "animated", "unimplemented"  );
      const layerNameText = layerName.appendChild( document.createElement( "span" ) );
      layerNameText.textContent = newLayer.layerName;
      layerName.uiActive = false;
      UI.registerElement(
        layerName,
        {
          onclick: () => {
            //TODO should be easy with overlay accessible now?
            console.log( "Layer name was clicked." );
          },
        },
        { tooltip: [ "!unimplemented! Rename Layer", "above", "to-left-of-center" ], zIndex:1000 },
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
            if( layersStack.layers[ index - 1 ]?.layerType === "paint" ) {
              const lowerLayer = layersStack.layers[ index - 1 ];
              //save the current, un-merged lower layer
              const oldData = lowerLayer.context.getImageData( 0,0,lowerLayer.w,lowerLayer.h );
              //merge this layer down onto the lower layer
              lowerLayer.context.save();
              lowerLayer.context.globalAlpha = newLayer.opacity;
              lowerLayer.context.drawImage( newLayer.canvas, 0, 0 );
              lowerLayer.context.restore();
              //flag the lower layer for GPU upload
              lowerLayer.textureChanged = true;
              lowerLayer.textureChangedRect.x = 0;
              lowerLayer.textureChangedRect.y = 0;
              lowerLayer.textureChangedRect.w = lowerLayer.w;
              lowerLayer.textureChangedRect.h = lowerLayer.h;
              //delete this upper layer from the stack
              layersStack.layers.splice( index, 1 );
              //remember this upper layer's parent and sibling for DOM-reinsertion
              const domSibling = newLayer.layerButton.nextElementSibling,
                domParent = newLayer.layerButton.parentElement;
              //remove this upper layer from DOM
              domParent.removeChild( newLayer.layerButton );
              //select the lower layer
              selectLayer( lowerLayer );
              //what happens to our nodes??? I don't even know. TBD
              console.error( "Delete layer isn't dealing with node-links." );
    
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
                  lowerLayer.textureChanged = true;
                  lowerLayer.textureChangedRect.x = 0;
                  lowerLayer.textureChangedRect.y = 0;
                  lowerLayer.textureChangedRect.w = lowerLayer.w;
                  lowerLayer.textureChangedRect.h = lowerLayer.h;
                  //reinsert the upper layer into the layer's stack
                  layersStack.layers.splice( historyEntry.index, 0, historyEntry.upperLayer );
                  //reinsert the upper layer into the DOM
                  historyEntry.domParent.insertBefore( historyEntry.upperLayer.layerButton, historyEntry.domSibling );
                  //recompute nodes because why not
                },
                redo: () => {
                  //delete the upper layer from the stack
                  layersStack.layers.splice( historyEntry.index, 1 );
                  //remove it from the DOM
                  historyEntry.domParent.removeChild( historyEntry.upperLayer.layerButton );
                  //blit the merged data agaain
                  historyEntry.lowerLayer.context.putImageData( historyEntry.newData, 0, 0 );
                  //and GPU upload
                  lowerLayer.textureChanged = true;
                  lowerLayer.textureChangedRect.x = 0;
                  lowerLayer.textureChangedRect.y = 0;
                  lowerLayer.textureChangedRect.w = lowerLayer.w;
                  lowerLayer.textureChangedRect.h = lowerLayer.h;
                  //all done theoretically yay
                  //seems all good for now
                }
              }
              recordHistoryEntry( historyEntry );
            } else {
              //Disable the merge button. We should never end up here, but who knows.
              mergeButton.classList.remove( "enabled" );
              mergeButton.uiActive = false;
            }

          },
          updateContext: () => {

            let isVisible = true;

            if( ! layerButton.classList.contains( "active" ) ) isVisible = false;
            
            if( isVisible === true ) {
              let canMerge = false;
              if( newLayer.layerType === "paint" ) {
                const index = layersStack.layers.indexOf( newLayer );
                if( layersStack.layers[ index - 1 ]?.layerType === "paint" ) {
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
                const { layer, apiFlowName, controlName } = uplink;
                if( layer === newLayer ) {
                  poppedUplinks.push( [uplinkingLayer,uplink] );
                  uplinkingLayer.nodeUplinks.delete( uplink );
                }
              }
            }

            selectLayer( newLayer );
    
            const historyEntry = {
              newLayer,
              poppedUplinks,
              undo: () => {
                historyEntry.newLayer.layerType = "generative";
                //reinstall popped uplinks
                for( const [uplinkingLayer,uplink] of historyEntry.poppedUplinks )
                  uplinkingLayer.nodeUplinks.add( uplink );
                UI.updateContext();
              },
              redo: () => {
                historyEntry.newLayer.layerType === "paint";
                //repop popped uplinks
                for( const [uplinkingLayer,uplink] of historyEntry.poppedUplinks )
                  uplinkingLayer.nodeUplinks.delete( uplink );
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
      if( newLayer.layerType === "paint" || newLayer.layerType === "layer-group" )
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
            console.log( "Dragging node link source for layer ", newLayer.layerName );

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
                        if( uplink.layer === selectedLayer && uplink.apiFlowName === apiFlowName && uplink.controlName === controlElement.controlName ) {
                          controlElement.uplinkLayer.nodeUplinks.delete( uplink );
                          break;
                        }
                      }
                      controlElement.uplinkLayer = null;
                    }

                    //dropped into new uplink destination, record
                    newLayer.nodeUplinks.add( {
                      layer: selectedLayer,
                      apiFlowName: controlsPanel.apiFlowName,
                      controlName: controlElement.controlName,
                      width: linkRect.left - ( ( controlRect.left + controlRect.right ) / 2 )
                      //element: controlElement
                    } );
                    controlElement.uplinkLayer = newLayer;

                    //remake the node links
                    UI.updateContext();

                    //stop searching
                    break;
                  }
                }
              }

            }
          },
          updateContext: () => {

            layerButton.appendChild( nodeLinkSource );

            let handleIsVisible = true;
            if( ! (newLayer.layerType === "paint" || newLayer.layerType === "layer-group") ) handleIsVisible = false;
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
                    for( const { layer, apiFlowName, controlName, width } of newLayer.nodeUplinks ) {
                      if( layer === selectedLayer && controlsPanel.apiFlowName === apiFlowName && controlName === controlElement.controlName ) {
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
    if( nextSibling ) {
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
    }

    //activate the layer
    selectLayer( newLayer );
  }

  if( layerType === "paint" || layerType === "generative" ) {
    const historyEntry = {
      newLayer, 
      stackIndex: layersStack.layers.indexOf( newLayer ),
      undo: () => {
        layersStack.layers.splice( historyEntry.stackIndex, 1 );
        layerButton.parentElement.removeChild( layerButton );
      },
      redo: () => {
        layersStack.layers.splice( historyEntry.stackIndex, 0, historyEntry.newLayer );
        if( layerSibling ) {
          document.querySelector( "#layers-column" ).insertBefore( layerButton, layerSibling );
        } else {
          document.querySelector( "#layers-column" ).appendChild( layerButton );
        }
      }
    }
    recordHistoryEntry( historyEntry );
  }

  return newLayer;
  
}

function composeLayers( destinationLayer, layers, layer0WidthPixels ) {
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

  console.log( minX, minY, maxX, maxY );

  //get the actual width of layer 0
  let pixelScale;
  {
    const layer = layers[ 0 ],
      dx = layer.topRight[0] - layer.topLeft[0],
      dy = layer.topRight[1] - layer.topLeft[1],
      d = Math.sqrt( dx**2 + dy**2 );
    pixelScale = layer0WidthPixels / d;

  }
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
}

async function deleteLayer( layer ) {

  //if this layer is selected, unselect it
  if( selectedLayer === layer ) selectedLayer = null;

  //delete from layer stack
  const index = layersStack.layers.indexOf( layer );
  layersStack.layers.splice( index, 1 );
  //remember the layer's parent and sibling in the DOM
  const domSibling = layer.layerButton.nextElementSibling,
    domParent = layer.layerButton.parentElement;
  //remove button from DOM
  domParent.removeChild( layer.layerButton );
  
  //add an undo entry
  const historyEntry = {
    index,
    newLayer: layer,
    domParent,
    domSibling,
    undo: () => {
      //insert into the layer stack
      layersStack.layers.splice( historyEntry.index, 0, historyEntry.newLayer );
      //insert into the DOM
      historyEntry.domParent.insertBefore( historyEntry.newLayer.layerButton, historyEntry.domSibling );
    },
    redo: () => {
      //delete from the layer stack
      layersStack.layers.splice( historyEntry.index, 1 );
      //remove button from DOM
      historyEntry.domParent.removeChild(  historyEntry.newLayer.layerButton );
    },
    cleanup: () => {
      //layer won't be coming back.
      gl.deleteTexture( layer.glTexture );
      gl.deleteTexture( layer.glMask );
    }
  }
  recordHistoryEntry( historyEntry );

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
  console.log( layer, layer.layerButton );
  for( const l of document.querySelectorAll( "#layers-column > .layer-button" ) ) {
    l.classList.remove( "active", "no-hover", "hovering" );
  }
  layer.layerButton.classList.add( "active", "no-hover" );
  layer.layerButton.classList.remove( "hovering" );
  layer.layerButton.querySelector( ".layer-name" ).uiActive = false;
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
    const secondsPerFrame = dt / 1000;
    const framesPerSecond = 1 / secondsPerFrame;
    fps = ( fps * 0.95 ) + framesPerSecond * 0.05;

    document.querySelector("#console" ).textContent = 
`20-frame FPS:  + ${fps.toString().substring(0,5)}
Info: ${info}`;

    if( looping ) window.requestAnimationFrame( Loop );
    //ctx.fillStyle = paperTexture || "rgb(128,128,128)";
    //ctx.fillRect( 0,0,W,H );
    updateCycle( t );

    //getTransform();
    //draw the layers
    /* for( const layer of layersStack.layers ) {
        const [x,y] = transformPoint( layer.topLeft ),
        [x2,y2] = transformPoint( layer.topRight );
        const dx = x2-x, dy=y2-y;
        const l = Math.sqrt( dx*dx + dy*dy );
        ctx.save();
        ctx.translate( x, y );
        ctx.rotate( Math.atan2( dy, dx ) );
        ctx.scale( l / layer.w, l / layer.h );
        ctx.globalAlpha = layer.opacity;
        ctx.drawImage( layer.canvas, 0, 0 );
        ctx.lineWidth = 1.0;
        ctx.strokeStyle = "black";
        ctx.strokeRect( 0, 0, layer.canvas.width, layer.canvas.height );
        ctx.restore();
    } */

    /* if( currentArtCanvas ) {
        //Next: Calculate from demo points to get xy, atan2
        const [x,y] = transformPoint( demoPoints[0] ),
          [x2,y2] = transformPoint( demoPoints[1] );
        const dx = x2-x, dy=y2-y;
        const l = Math.sqrt( dx*dx + dy*dy );
        ctx.save();
        ctx.translate( x, y );
        ctx.rotate( Math.atan2( dy, dx ) );
        ctx.scale( l / 1024, l / 1024 )
        ctx.drawImage( currentArtCanvas, 0, 0 );
        ctx.restore();

        //also preview in corner for point persistence test
        ctx.drawImage( currentArtCanvas, 0, H - currentArtCanvas.height/16, currentArtCanvas.width/16, currentArtCanvas.height/16)
    } */
    
    //stroke( demoPoints );

    //draw cursor state
    /* if( pointers.count === 1 ) {
        if( cursor.mode !== "none" ) {
            ctx.save();
            ctx.strokeStyle = "rgb(200,220,250)";
            ctx.lineWidth = 4.0;
            ctx.beginPath();
            ctx.moveTo( cursor.origin.x , cursor.origin.y );
            ctx.lineTo( cursor.current.x , cursor.current.y );
            ctx.stroke();
            ctx.restore();
        }
    } */

    //writeInfo();

    //drawGL();

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

      const visibleLayers = [];
      let paintPreviewLayer = null;
      for( const layer of layersStack.layers ) {
        if( layer.layerType === "paint-preview" ) {
          paintPreviewLayer = layer;
          continue;
        }
        if( layer.visible ) {
          visibleLayers.push( layer );
        }
      }
      //layer ordering not implemented. Might be the wrong way to do it.
      //visibleLayers.sort( (a,b)=>a.layerOrder-b.layerOrder );
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
        const xy = [x,y], xy2 = [x2,y2], xy3 = [x3,y3], xy4 = [x4,y4];
        //convert that screenspace to GL space
        const glox = W/2, gloy = H/2;
        for( const p of [xy,xy2,xy3,xy4] ) {
          p[0] -= glox; p[1] -= gloy;
          //We're flipping the y coordinate! OpenGL NDC space defines the bottom of the screen as -1 y, and the top as +1 y (center 0).
          p[0] /= glox; p[1] /= -gloy;
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
        if( layer.textureChanged ) {
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
        if( layer.maskChanged ) {
          //re-upload the layer's mask when it's changed
          const mipLevel = 0,
          internalFormat = gl.RGBA,
          srcFormat = gl.RGBA,
          srcType = gl.UNSIGNED_BYTE;
          gl.texImage2D( gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, layer.maskCanvas );
          layer.maskChanged = false;
        }


        //set the layer's alpha
        gl.uniform1f( glState.alphaInputIndex, layer.opacity );
        let maskVisibility = 0.0;
        if( layer === selectedLayer && uiSettings.activeTool === "mask" && layer.maskInitialized && painter.active && painter.queue.length )
          maskVisibility = 0.5;
        gl.uniform1f( glState.alphaMaskIndex, maskVisibility );

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

    //setup the paint preview
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

function drawGL() {
  gl.clearColor(0,0.1,0.2,1); //slight color to see clear effect
  gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
  gl.useProgram( glState.program );
  gl.bindVertexArray(glState.vao);
  gl.uniform1i( gl.getUniformLocation( glState.program, "img" ), 0 );
  gl.uniform1f( glState.alphaInputIndex, 1.0 );
  {
    const primitiveType = gl.TRIANGLES,
      structStartOffset = 0,
      structCount = 3;
      gl.drawArrays( primitiveType, structStartOffset, structCount );
  }
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
    in vec2 uv;
    out vec4 outColor;
    
    void main() {
      vec4 lookup = texture(img,uv);
      vec4 maskLookup = texture(imgMask,uv);
      lookup.a *= alpha * maskLookup.a;
      if( lookup.a < 0.01 ) {
        lookup = vec4( 1.0,1.0,1.0, mask * maskLookup.a );
      }
      outColor = lookup;
      if( uv.x < 0.001 || uv.x > 0.999 || uv.y < 0.001 || uv.y > 0.999 ) {
        outColor = vec4( 0.0,0.0,0.0,1.0 );
      }
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
    document.querySelector( ".paint-tools-options-color-well" ).style.backgroundColor = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.colorStyle;
  }
  airInput.insideEyedropperRadius = false;
  airInput.active = false;
  airInput.started.x = 0;
  airInput.started.y = 0;
  airInput.current.x = 0;
  airInput.current.y = 0;
  airInput.uiElement.style.display = "none";
}

let uiSettings = {

  gpuPaint: false,

  maxUndoSteps: 20,

  setActiveTool: tool => {
    uiSettings.activeTool = tool;
    UI.updateContext();
  },

  activeTool: null, //null | generate | paint | mask | transform
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
              get colorStyle() {
                const {h,s,l} = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl;
                const [r,g,b] = hslToRgb( h,s,l );
                return `rgb(${r},${g},${b})`;
              },
              get rgbFloat() {
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
  },

  paint: { r:200,g:220,b:240 },
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
  brushProfile: p => uiSettings.brushSize,

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

/* const uiControls = {
  paintControlElements: [],
  hidePaintControls: () => {
    document.querySelector( "#paint-controls" ).style.display = "none";
    uiControls.paintControlElements.forEach( e => e.uiActive = false );
  },
  showPaintControls: () => {
    document.querySelector( "#paint-controls" ).style.display = "block";
    document.querySelector( "#paint-controls" ).classList.remove( "mask" );
    document.querySelector( ".paint-controls-label" ).textContent = "Paint";
    uiControls.paintControlElements.forEach( e => e.uiActive = true );
    uiSettings.activeTool = "paint";
  },
  showMaskControls: () => {
    document.querySelector( "#paint-controls" ).style.display = "block";
    document.querySelector( "#paint-controls" ).classList.add( "mask" );
    document.querySelector( ".paint-controls-label" ).textContent = "Mask";
    uiControls.paintControlElements.forEach( e => e.uiActive = true );
    uiSettings.activeTool = "mask";
    uiSettings.toolsSettings.paint.mode = "brush";
    UI.updateContext(); //elements can check settings too, after all
  },

  genControlElements: [],
  hideGenControls: () => {
    document.querySelector( "#gen-controls" ).style.display = "none";
    uiControls.genControlElements.forEach( e => e.uiActive = false );
  },
  showGenControls: () => {
    document.querySelector( "#gen-controls" ).style.display = "block";
    uiControls.genControlElements.forEach( e => e.uiActive = true );
  },

} */

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
            if( ! selectedLayer ) {
              maskButton.classList.add( "unavailable" );
              maskButton.querySelector(".tooltip" ).textContent = "Mask Tool [Select layer to enable]";
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
      transformButton.classList.add( "tools-column-transform-button", "round-toggle", "animated", "unimplemented", "unavailable" );
      toolsColumn.appendChild( transformButton );
      UI.registerElement(
        transformButton,
        {
          onclick: () => {
            if( ! transformButton.classList.contains( "unavailable" ) && ! transformButton.classList.contains( "unimplemented" ) ) {
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
  }

  //the paint tool options
  {
    console.error( "UI.updateContext() needs to rebuild list of hidden elements, not check every mouse move." );
    const paintToolOptionsRow = document.createElement( "div" );
    paintToolOptionsRow.classList.add( "flex-row", "hidden", "animated" );
    paintToolOptionsRow.id = "paint-tools-options-row";
    uiContainer.appendChild( paintToolOptionsRow );
    UI.registerElement(
      paintToolOptionsRow,
      {
        updateContext: () => {
          if( uiSettings.activeTool === "paint" ) {
            paintToolOptionsRow.classList.remove( "hidden" );
            document.querySelector( ".paint-tools-options-color-well" ).classList.remove( "hidden" );
          }
          else if( uiSettings.activeTool === "mask" ) {
            paintToolOptionsRow.classList.remove( "hidden" );
            document.querySelector( ".paint-tools-options-color-well" ).classList.add( "hidden" );
          }
          else {
            paintToolOptionsRow.classList.add( "hidden" );
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
      paintToolOptionsRow.appendChild( brushSelectBrowseButton );
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
      paintToolOptionsRow.appendChild( paintModeButton );
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
      paintToolOptionsRow.appendChild( blendMode );
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
      paintToolOptionsRow.appendChild( eraseMode );
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
      paintToolOptionsRow.appendChild( retractableSizeSlider );
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
      paintToolOptionsRow.appendChild( retractableSoftnessSlider );
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
      paintToolOptionsRow.appendChild( retractableOpacitySlider );
    }
    //the colorwell
    {
      const colorWell = document.createElement( "div" );
      colorWell.classList.add( "paint-tools-options-color-well", "animated" );
      colorWell.style.backgroundColor = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.colorStyle;
      UI.registerElement(
        colorWell,
        {
          onclick: () => {
            colorWell.style.backgroundColor = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.colorStyle;
            document.querySelector( "#color-wheel" )?.toggleVisibility?.();
          }
        },
        {
          tooltip: [ "Change Color", "below", "to-left-of-center" ], zIndex:10000,
        }
      );
      paintToolOptionsRow.appendChild( colorWell );
    }
  }

  //the color wheel panel
  {

  }

  //the paint controls
  /* let colorWell;
  {

    const paintControls = document.createElement( "div" );
    paintControls.id = "paint-controls";
    ui.appendChild( paintControls );
  

    //the color palette
    const colorPalette = document.createElement( "div" );
    colorPalette.classList.add( "palette" );
    for( const r of [0,128,255] ) {
      for( const g of [0,128,255] ) {
        for( const b of [0,128,255 ] ) {
          const [fh,fs,fl] = rgbToHsl( r,g,b );
          let h = fh * 360, s = fs * 100, l = fl * 100;
          const color = document.createElement( "button" );
          color.classList.add( "color" );
          color.style.backgroundColor = `hsl(${h},${s}%,${l}%)`;
          registerUIElement( color, { onclick: () => {
              colorWell.style.backgroundColor = color.style.backgroundColor;
              uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.h = fh;
              uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.s = fs;
              uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.l = fl;
            }
          } );
          uiControls.paintControlElements.push( color );
          colorPalette.appendChild( color );
        }
      }
    }
    
    paintControls.appendChild( colorPalette );

    {
      //the colorwheel summoner
      colorWell = document.createElement( "div" );
      colorWell.classList.add( "color-well" );
      colorWell.style.backgroundColor = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.colorStyle;
      let open = false;
      registerUIElement( colorWell, { onclick: () => {
        colorWheel.style.display = ( open = !open ) ? "block" : "none";
        colorWheel.uiActive = open;
        colorWell.style.backgroundColor = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.colorStyle;
        if( open ) updateColorWheelPreview();
      } } );
      uiControls.paintControlElements.push( colorWell );
      paintControls.appendChild( colorWell );

    }
    paintControls.style.display = "none";
  } */
  
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
            console.log( "Generate!" );

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
                let layerInput = selectedLayer;
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
                controlValues[ control.controlName ] = sourceLayer.canvas.toDataURL();
              }
            }

            //for any values not provided, executeAPICall will retain the default values encoded in those controls, including "static" controltypes

            //do the generation
            const result = await executeAPICall( apiFlowName, controlValues );
            console.log( "Got result!: ", result[ "generated-image" ] );
            //absolutely everywhere I reference CTX calls like this will need to change with GPU paint?
            //Or... Hmm. Maybe I use those pixelreads to update these canvases.
            //Well... I have to keep the canvases anyway, right??? For previews. So no change???
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

  //the generative controls
  /* {
    const genControls = document.createElement( "div" );
    genControls.id = "gen-controls";

    const prompt = document.createElement( "input" );
    prompt.type = "text";
    prompt.value = "desktop cat";
    prompt.id = "gen-prompt";
    registerUIElement( prompt, { onclick: () => prompt.focus() } );
    uiControls.genControlElements.push( prompt );
    genControls.appendChild( prompt );

    const gen = document.createElement( "button" );
    gen.class = "generate";
    gen.textContent = "Generate";
    registerUIElement( gen, {onclick: async () => {
      let api = "txt2img",
       img2img = null,
       denoise = 0;

      //try to set img2img
      if( genControls.classList.contains( "img2img" ) ) {
        //lets find the image
        for( const link of linkedNodes ) {
          if( link.destinationNode.isNode === "img2img" &&
              link.destinationLayer === selectedLayer ) {
            //found the link!
            const sourceLayer = link.sourceLayer;
            const sourceCanvas = sourceLayer.canvas;
            console.log( "Found img2img source canvas: ", sourceCanvas );
            api = "img2img";
            img2img = sourceCanvas.toDataURL();
            denoise = document.querySelector("input.denoise").value*1;
          }
        }
      }

      //try to set inpainting
      let inpaint = false,
        inpaintFill = "original",
        inpaintZoomed = false;
      if( api === "img2img" ) {
        if( selectedLayer.maskInitialized ) {
          inpaint = true;
          //default
          //inpaint = "original";
          const inpaintZoomedChecked = !!(document.querySelector( "input.inpaintZoomed" ).checked);
          if( inpaintZoomedChecked ) inpaintZoomed = true;
          else inpaintZoomed = false;
        }
      }

      let usingLineart = false,
        lineartStrength = 0

      if( genControls.classList.contains( "lineart" ) ) {
        //lets find the source lineart canvas
        const layer = selectedLayer;
        for( const link of linkedNodes ) {
          if( link.destinationNode.isNode === "lineart" &&
              link.destinationLayer === layer ) {
            //found the link!
            const sourceLayer = link.sourceLayer;
            const paintPreviewLayer = layersStack.layers[ 0 ];
            //convert lineart alpha to white-black
            const lineartData = sourceLayer.context.getImageData(0,0,sourceLayer.w,sourceLayer.h),
                d = lineartData.data;
            for( let i=0; i<d.length; i+=4 ) {
              d[i] = d[i+1] = d[i+2] = d[i+3];
              d[i+3] = 255;
            }
            paintPreviewLayer.canvas.width = sourceLayer.w;
            paintPreviewLayer.canvas.height = sourceLayer.h;
            paintPreviewLayer.context.putImageData( lineartData,0,0 );
            lineart = paintPreviewLayer.canvas.toDataURL();
            paintPreviewLayer.context.clearRect(0,0,paintPreviewLayer.w,paintPreviewLayer.h);
            lineartStrength = document.querySelector("input.lineart").value*1;
            apisSettings.a1111.setControlNet( { enabled: true, slot:0, lineart, lineartStrength, model:"sai_xl_sketch_256lora [cd3389b1]" } )
            usingLineart = true;
          }
        }
      }
      if( usingLineart === false )
        apisSettings.a1111.setControlNet( { enabled: false, slot: 0 } );

      console.log( "Doing: ", api, img2img, denoise, usingLineart, prompt );
      const p = prompt.value;
      const img = await getImageA1111( { api, prompt:p, img2img, denoise, inpaint, inpaintFill, inpaintZoomed } );
      selectedLayer.context.drawImage( img, 0, 0 );
      selectedLayer.textureChanged = true;
      selectedLayer.textureChangedRect.x = 0;
      selectedLayer.textureChangedRect.y = 0;
      selectedLayer.textureChangedRect.w = selectedLayer.w;
      selectedLayer.textureChangedRect.h = selectedLayer.h;
    }});
    uiControls.genControlElements.push( gen );
    genControls.appendChild( gen );

    {
      const presetSelector = document.createElement( "select" );
      for( const preset of ["fast","quality"] ) {
        const opt = document.createElement( "option" );
        opt.value = preset;
        opt.textContent = preset;
        presetSelector.appendChild( opt );
      }
      genControls.appendChild( document.createTextNode("Preset") );
      genControls.appendChild( presetSelector );
    }

    {
      const modelSelect = document.createElement( "select" );
      for( const model of apisSettings.a1111.modelNames ) {
        const opt = document.createElement( "option" );
        opt.value = model;
        opt.textContent = model;
        modelSelect.appendChild( opt );
      }
      genControls.appendChild( document.createTextNode("Model") );
      genControls.appendChild( modelSelect );
    }

    {
      const cfg = document.createElement( "input" );
      cfg.type = "number";
      cfg.min = 1;
      cfg.max = 20;
      cfg.step = 0.5;
      cfg.value = 1.0;
      genControls.appendChild( document.createTextNode("CFG") );
      genControls.appendChild( cfg );  
    }

    {
      const steps = document.createElement( "input" );
      steps.type = "number";
      steps.min = 1;
      steps.max = 100;
      steps.step = 1;
      steps.value = 4;
      genControls.appendChild( document.createTextNode("Steps") );
      genControls.appendChild( steps );  
    }
    {
      const samplerSelect = document.createElement( "select" );
      for( const sampler of apisSettings.a1111.samplerNames ) {
        const opt = document.createElement( "option" );
        opt.value = sampler;
        opt.textContent = sampler;
        samplerSelect.appendChild( opt );
      }
      genControls.appendChild( document.createTextNode("Sampler") );
      genControls.appendChild( samplerSelect );
    }
    {
      //img2img denoise slider
      const denoiseSlider = document.createElement("input");
      denoiseSlider.type = "range";
      denoiseSlider.classList.add( "denoise" );
      denoiseSlider.value = 0.8;
      denoiseSlider.min = 0;
      denoiseSlider.max = 1;
      denoiseSlider.step = "any";
      denoiseSlider.style.position = "static";
      const updateDenoise =  ( {rect,current} ) => {
        let {x,y} = current;
        x -= rect.left; y -= rect.top;
        x /= rect.width; y /= rect.height;
        x = Math.max( 0, Math.min( 1, x ) );
        y = Math.max( 0, Math.min( 1, y ) );
        const p = x;
        denoiseSlider.value = parseFloat(denoiseSlider.min) + (parseFloat(denoiseSlider.max) - parseFloat(denoiseSlider.min))*p;
      };
      registerUIElement( denoiseSlider, { ondrag: updateDenoise } );
      uiControls.genControlElements.push( denoiseSlider );
      const denoiseHolder = document.createElement( "div" );
      denoiseHolder.classList.add( "img2img" );
      denoiseHolder.style = "position:relative; width:auto;";
      denoiseHolder.appendChild( document.createTextNode("Denoise") );
      denoiseHolder.appendChild( denoiseSlider );
      genControls.appendChild( denoiseHolder );
    }
    if( false ){
      //inpainting zoomed check
      const inpaintZoomed = document.createElement( "input" );
      inpaintZoomed.type = "checkbox"
      inpaintZoomed.classList.add( "inpaintZoomed" );
      //inpaintZoomed.checked = false;
      registerUIElement( inpaintZoomed, { onclick: () => { inpaintZoomed.checked = !inpaintZoomed.checked; } } );
      uiControls.genControlElements.push( inpaintZoomed );
      const inpaintZoomedHolder = document.createElement( "div" );
      inpaintZoomedHolder.classList.add( "img2img" );
      inpaintZoomedHolder.style = "position:relative; width:auto;";
      inpaintZoomedHolder.appendChild( document.createTextNode("Inpaint Zoomed") );
      inpaintZoomedHolder.appendChild( inpaintZoomed );
      genControls.appendChild( inpaintZoomedHolder );
    }
    {
      //controlnet lineart slider
      const lineartStength = document.createElement("input");
      lineartStength.type = "range";
      lineartStength.classList.add( "lineart" );
      lineartStength.value = 0.8;
      lineartStength.min = 0;
      lineartStength.max = 1;
      lineartStength.step = "any";
      lineartStength.style.position = "static";
      const updateLineartStrength =  ( {rect,current} ) => {
        let {x,y} = current;
        x -= rect.left; y -= rect.top;
        x /= rect.width; y /= rect.height;
        x = Math.max( 0, Math.min( 1, x ) );
        y = Math.max( 0, Math.min( 1, y ) );
        const p = x;
        lineartStength.value = parseFloat(lineartStength.min) + (parseFloat(lineartStength.max) - parseFloat(lineartStength.min))*p;
      };
      registerUIElement( lineartStength, { ondrag: updateLineartStrength } );
      uiControls.genControlElements.push( lineartStength );
      const lineartStrengthHolder = document.createElement( "div" );
      lineartStrengthHolder.classList.add( "lineart" );
      lineartStrengthHolder.style = "position:relative; width:auto;";
      lineartStrengthHolder.appendChild( document.createTextNode("Lineart Strength") );
      lineartStrengthHolder.appendChild( lineartStength );
      genControls.appendChild( lineartStrengthHolder );
    }

    genControls.style.display = "none";
    ui.appendChild( genControls );

    

  } */

  //the console
  const consoleElement = uiContainer.appendChild( document.createElement( "div" ) );
  consoleElement.id = "console";

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
            if( selectedLayer ) addCanvasLayer( "generative", selectedLayer.w, selectedLayer.h, selectedLayer );
            else addCanvasLayer( "generative" );
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
            if( selectedLayer ) addCanvasLayer( "paint", selectedLayer.w, selectedLayer.h, selectedLayer );
            else addCanvasLayer( "paint" );
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
        //add the import image button
        const importImageButton = addLayersPanel.appendChild( document.createElement( "div" ) );
        importImageButton.classList.add( "rounded-line-button", "animated", "unimplemented" );
        importImageButton.appendChild( new Image() ).src = "icon/picture.png";
        importImageButton.appendChild( document.createElement("span") ).textContent = "Import Image as Layer";
        UI.registerElement( importImageButton, {
          onclick: () => {
            importImageButton.classList.add( "pushed" );
            setTimeout( () => importImageButton.classList.remove( "pushed" ), UI.animationMS );
            UI.deleteContext( "add-layers-panel-visible" );
            console.error( "Image import unimplemented." );
          },
          updateContext: context => {
            if( context.has( "add-layers-panel-visible" ) ) importImageButton.uiActive = true;
            else importImageButton.uiActive = false;
          }
        }, { 
          tooltip: [ "!Unimplemented! Import Image as Layer", "to-left", "vertical-center" ],
          zIndex: 11000,
        } );
      }

      //add a spacer
      addLayersPanel.appendChild( document.createElement( "div" ) ).className = "spacer";

      {
        //add the layers group add button
        const addLayerGroupButton = addLayersPanel.appendChild( document.createElement( "div" ) );
        addLayerGroupButton.classList.add( "rounded-line-button", "animated", "unimplemented" );
        addLayerGroupButton.appendChild( new Image() ).src = "icon/folder.png";
        addLayerGroupButton.appendChild( document.createElement("span") ).textContent = "Add Layer Group";
        UI.registerElement( addLayerGroupButton, {
          onclick: () => {
            addLayerGroupButton.classList.add( "pushed" );
            setTimeout( () => addLayerGroupButton.classList.remove( "pushed" ), UI.animationMS );
            //addCanvasLayer( "paint" );
            UI.deleteContext( "add-layers-panel-visible" );
            console.error( "Add layer group unimplemented." );
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
  console.log( "Found apiFlow: ", apiFlow, " for name ", apiFlowName );
  for( const control of apiFlow.controls ) {

    //load control from layer if any
    control.controlValue = selectedLayer.generativeControls[ apiFlowName ]?.[ control.controlName ] || control.controlValue;

    //store control value in selected layer
    selectedLayer.generativeControls[ apiFlowName ][ control.controlName ] = control.controlValue;

    //make the element from the type
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
        { onclick: () => {
          //TODO NEXT: Open the overlay to get text input (or back out to leave value unchanged)
          const textInput = document.querySelector( "#multiline-text-input-overlay" );
          textInput.setText( control.controlValue );
          textInput.onapply = text => {
            controlElementText.textContent = text;
            control.controlValue = text;
          }
          textInput.show();
        } },
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
          if( uplink.layer === selectedLayer && uplink.apiFlowName === apiFlowName && uplink.controlName === control.controlName ) {
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
              if( uplink.layer === selectedLayer && uplink.apiFlowName === apiFlowName && uplink.controlName === control.controlName ) {
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

function setupUI_old() {
  
  //the fullscreen button
  const button = document.createElement( "button" );
  button.className = "fullscreen";
  button.textContent = "Fullscreen v" + VERSION;
  registerUIElement( button, {
    onclick: () => {
      if( document.fullscreenElement ) {
        document.exitFullscreen?.();
      } else {
        main.requestFullscreen();
      }
    }
  } );
  uiContainer.appendChild( button );

  let colorWell;
  {
    //the paint controls

    const paintControls = document.createElement( "div" );
    paintControls.id = "paint-controls";
    uiContainer.appendChild( paintControls );

    //the mode label
    {
      const modeLabel = document.createElement( "div" );
      modeLabel.className = "paint-controls-label";
      modeLabel.textContent = "Paint";
      paintControls.appendChild( modeLabel );
    }
    //the brush selector
    {
      const paintButton = document.createElement( "button" );
      paintButton.className = "paint-controls-button";
      paintButton.textContent = "Color";
      registerUIElement( paintButton, { onclick: () => {
        //uiSettings.activeTool = "paint";
        uiSettings.toolsSettings.paint.mode = "brush";
      }} );
      paintControls.appendChild( paintButton );
      uiControls.paintControlElements.push( paintButton );
    }
    //the blend selector
    {
      const paintButton = document.createElement( "button" );
      paintButton.className = "paint-controls-button";
      paintButton.textContent = "Blend";
      registerUIElement( paintButton, { onclick: () => {
        //uiSettings.activeTool = "paint";
        uiSettings.toolsSettings.paint.mode = "blend";
      }} );
      paintControls.appendChild( paintButton );
      uiControls.paintControlElements.push( paintButton );
    }
    //the erase selector
    {
      const eraseButton = document.createElement( "button" );
      eraseButton.className = "paint-controls-button";
      eraseButton.textContent = "Erase";
      registerUIElement( eraseButton, { onclick: () => {
        //uiSettings.activeTool = "paint";
        uiSettings.toolsSettings.paint.mode = "erase";
      } } );
      paintControls.appendChild( eraseButton );
      uiControls.paintControlElements.push( eraseButton );
    }
  
    {
      //the brushsize slider
      const brushSizeSlider = document.createElement("input");
      brushSizeSlider.type = "range";
      brushSizeSlider.classList.add( "brush-size" );
      brushSizeSlider.classList.add( "vertical" );
      brushSizeSlider.value = uiSettings.brushSize;
      brushSizeSlider.min = 2.5;
      brushSizeSlider.max = 14;
      brushSizeSlider.step = "any";
      brushSizeSlider.setAttribute( "orient", "vertical" );
      brushSizeSlider.orient = "vertical";
      brushSizeSlider.style.appearance = "slider-vertical";
      const updateSize = ( {rect,current} ) => {
        let {x,y} = current;
        x -= rect.left; y -= rect.top;
        x /= rect.width; y /= rect.height;
        x = Math.max( 0, Math.min( 1, x ) );
        y = Math.max( 0, Math.min( 1, y ) );
        const p = 1 - y;
        brushSizeSlider.value = parseFloat(brushSizeSlider.min) + (parseFloat(brushSizeSlider.max) - parseFloat(brushSizeSlider.min))*p;
        uiSettings.toolsSettings.paint.modeSettings.all.brushSize = parseFloat(brushSizeSlider.value);
      };
      registerUIElement( brushSizeSlider, { ondrag: updateSize } );
      uiControls.paintControlElements.push( brushSizeSlider );
      paintControls.appendChild( brushSizeSlider );
    }
    
    {
      //the brush opacity slider
      const brushOpacity = document.createElement("input");
      brushOpacity.type = "range";
      brushOpacity.classList.add( "brush-opacity" );
      brushOpacity.classList.add( "vertical" );
      brushOpacity.value = uiSettings.brushOpacity;
      brushOpacity.min = 0;
      brushOpacity.max = 1;
      brushOpacity.step = 1/256;
      brushOpacity.setAttribute( "orient", "vertical" );
      brushOpacity.orient = "vertical";
      brushOpacity.style.appearance = "slider-vertical";
      const updateOpacity = ( {rect,current} ) => {
        let {x,y} = current;
        x -= rect.left; y -= rect.top;
        x /= rect.width; y /= rect.height;
        x = Math.max( 0, Math.min( 1, x ) );
        y = Math.max( 0, Math.min( 1, y ) );
        const p = 1 - y;
        brushOpacity.value = parseFloat(brushOpacity.min) + (parseFloat(brushOpacity.max) - parseFloat(brushOpacity.min))*p;
        uiSettings.toolsSettings.paint.modeSettings.all.brushOpacity = parseFloat(brushOpacity.value);
      };
      registerUIElement( brushOpacity, { ondrag: updateOpacity } );
      uiControls.paintControlElements.push( brushOpacity );
      paintControls.appendChild( brushOpacity );
    }

    {
      //the brush blur slider
      const brushBlurSlider = document.createElement("input");
      brushBlurSlider.type = "range";
      brushBlurSlider.classList.add( "brush-blur" );
      brushBlurSlider.classList.add( "vertical" );
      brushBlurSlider.value = uiSettings.brushBlur;
      brushBlurSlider.min = 0;
      brushBlurSlider.max = 0.4;
      //brushBlurSlider.max = 1;
      brushBlurSlider.step = "any";
      brushBlurSlider.setAttribute( "orient", "vertical" );
      brushBlurSlider.orient = "vertical";
      brushBlurSlider.style.appearance = "slider-vertical";
      const updateBlur = ( {rect,current} ) => {
        let {x,y} = current;
        x -= rect.left; y -= rect.top;
        x /= rect.width; y /= rect.height;
        x = Math.max( 0, Math.min( 1, x ) );
        y = Math.max( 0, Math.min( 1, y ) );
        const p = 1 - y;
        brushBlurSlider.value = parseFloat(brushBlurSlider.min) + (parseFloat(brushBlurSlider.max) - parseFloat(brushBlurSlider.min))*p;
        uiSettings.toolsSettings.paint.modeSettings.all.brushBlur = parseFloat(brushBlurSlider.value);
      };
      registerUIElement( brushBlurSlider, { ondrag: updateBlur } );
      uiControls.paintControlElements.push( brushBlurSlider );
      paintControls.appendChild( brushBlurSlider );
    }

    //the color palette
    const colorPalette = document.createElement( "div" );
    colorPalette.classList.add( "palette" );
    for( const r of [0,128,255] ) {
      for( const g of [0,128,255] ) {
        for( const b of [0,128,255 ] ) {
          const [fh,fs,fl] = rgbToHsl( r,g,b );
          let h = fh * 360, s = fs * 100, l = fl * 100;
          const color = document.createElement( "button" );
          color.classList.add( "color" );
          color.style.backgroundColor = `hsl(${h},${s}%,${l}%)`;
          registerUIElement( color, { onclick: () => {
              colorWell.style.backgroundColor = color.style.backgroundColor;
              uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.h = fh;
              uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.s = fs;
              uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.l = fl;
            }
          } );
          uiControls.paintControlElements.push( color );
          colorPalette.appendChild( color );
        }
      }
    }
    /* const eraser = document.createElement( "button" );
    eraser.classList.add( "eraser" );
    registerUIElement( eraser, { onclick: () => uiSettings.brush = "erase" } );
    uiControls.paintControlElements.push( eraser );
    colorPalette.appendChild( eraser ); */
    paintControls.appendChild( colorPalette );

    {
      //the colorwheel summoner
      colorWell = document.createElement( "div" );
      colorWell.classList.add( "color-well" );
      colorWell.style.backgroundColor = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.colorStyle;
      let open = false;
      registerUIElement( colorWell, { onclick: () => {
        colorWheel.style.display = ( open = !open ) ? "block" : "none";
        colorWheel.uiActive = open;
        colorWell.style.backgroundColor = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.colorStyle;
        if( open ) updateColorWheelPreview();
      } } );
      uiControls.paintControlElements.push( colorWell );
      paintControls.appendChild( colorWell );

    }
    paintControls.style.display = "none";
  }

  {
    //the generative controls
    const genControls = document.createElement( "div" );
    genControls.id = "gen-controls";

    const prompt = document.createElement( "input" );
    prompt.type = "text";
    prompt.value = "desktop cat";
    prompt.id = "gen-prompt";
    registerUIElement( prompt, { onclick: () => prompt.focus() } );
    uiControls.genControlElements.push( prompt );
    genControls.appendChild( prompt );

    const gen = document.createElement( "button" );
    gen.class = "generate";
    gen.textContent = "Generate";
    registerUIElement( gen, {onclick: async () => {
      let api = "txt2img",
       img2img = null,
       denoise = 0;

      //try to set img2img
      if( genControls.classList.contains( "img2img" ) ) {
        //lets find the image
        for( const link of linkedNodes ) {
          if( link.destinationNode.isNode === "img2img" &&
              link.destinationLayer === selectedLayer ) {
            //found the link!
            const sourceLayer = link.sourceLayer;
            const sourceCanvas = sourceLayer.canvas;
            console.log( "Found img2img source canvas: ", sourceCanvas );
            api = "img2img";
            img2img = sourceCanvas.toDataURL();
            denoise = document.querySelector("input.denoise").value*1;
          }
        }
      }

      //try to set inpainting
      let inpaint = false,
        inpaintFill = "original",
        inpaintZoomed = false;
      if( api === "img2img" ) {
        if( selectedLayer.maskInitialized ) {
          inpaint = true;
          //default
          //inpaint = "original";
          const inpaintZoomedChecked = !!(document.querySelector( "input.inpaintZoomed" ).checked);
          if( inpaintZoomedChecked ) inpaintZoomed = true;
          else inpaintZoomed = false;
        }
      }

      let usingLineart = false,
        lineartStrength = 0

      if( genControls.classList.contains( "lineart" ) ) {
        //lets find the source lineart canvas
        const layer = selectedLayer;
        for( const link of linkedNodes ) {
          if( link.destinationNode.isNode === "lineart" &&
              link.destinationLayer === layer ) {
            //found the link!
            const sourceLayer = link.sourceLayer;
            const paintPreviewLayer = layersStack.layers[ 0 ];
            //convert lineart alpha to white-black
            const lineartData = sourceLayer.context.getImageData(0,0,sourceLayer.w,sourceLayer.h),
                d = lineartData.data;
            for( let i=0; i<d.length; i+=4 ) {
              d[i] = d[i+1] = d[i+2] = d[i+3];
              d[i+3] = 255;
            }
            paintPreviewLayer.canvas.width = sourceLayer.w;
            paintPreviewLayer.canvas.height = sourceLayer.h;
            paintPreviewLayer.context.putImageData( lineartData,0,0 );
            lineart = paintPreviewLayer.canvas.toDataURL();
            paintPreviewLayer.context.clearRect(0,0,paintPreviewLayer.w,paintPreviewLayer.h);
            lineartStrength = document.querySelector("input.lineart").value*1;
            apisSettings.a1111.setControlNet( { enabled: true, slot:0, lineart, lineartStrength, model:"sai_xl_sketch_256lora [cd3389b1]" } )
            usingLineart = true;
          }
        }
      }
      if( usingLineart === false )
        apisSettings.a1111.setControlNet( { enabled: false, slot: 0 } );

      console.log( "Doing: ", api, img2img, denoise, usingLineart, prompt );
      const p = prompt.value;
      const img = await getImageA1111( { api, prompt:p, img2img, denoise, inpaint, inpaintFill, inpaintZoomed } );
      selectedLayer.context.drawImage( img, 0, 0 );
      selectedLayer.textureChanged = true;
      selectedLayer.textureChangedRect.x = 0;
      selectedLayer.textureChangedRect.y = 0;
      selectedLayer.textureChangedRect.w = selectedLayer.w;
      selectedLayer.textureChangedRect.h = selectedLayer.h;
    }});
    uiControls.genControlElements.push( gen );
    genControls.appendChild( gen );

    {
      const presetSelector = document.createElement( "select" );
      for( const preset of ["fast","quality"] ) {
        const opt = document.createElement( "option" );
        opt.value = preset;
        opt.textContent = preset;
        presetSelector.appendChild( opt );
      }
      genControls.appendChild( document.createTextNode("Preset") );
      genControls.appendChild( presetSelector );
    }

    {
      const modelSelect = document.createElement( "select" );
      for( const model of apisSettings.a1111.modelNames ) {
        const opt = document.createElement( "option" );
        opt.value = model;
        opt.textContent = model;
        modelSelect.appendChild( opt );
      }
      genControls.appendChild( document.createTextNode("Model") );
      genControls.appendChild( modelSelect );
    }

    {
      const cfg = document.createElement( "input" );
      cfg.type = "number";
      cfg.min = 1;
      cfg.max = 20;
      cfg.step = 0.5;
      cfg.value = 1.0;
      genControls.appendChild( document.createTextNode("CFG") );
      genControls.appendChild( cfg );  
    }

    {
      const steps = document.createElement( "input" );
      steps.type = "number";
      steps.min = 1;
      steps.max = 100;
      steps.step = 1;
      steps.value = 4;
      genControls.appendChild( document.createTextNode("Steps") );
      genControls.appendChild( steps );  
    }
    {
      const samplerSelect = document.createElement( "select" );
      for( const sampler of apisSettings.a1111.samplerNames ) {
        const opt = document.createElement( "option" );
        opt.value = sampler;
        opt.textContent = sampler;
        samplerSelect.appendChild( opt );
      }
      genControls.appendChild( document.createTextNode("Sampler") );
      genControls.appendChild( samplerSelect );
    }
    {
      //img2img denoise slider
      const denoiseSlider = document.createElement("input");
      denoiseSlider.type = "range";
      denoiseSlider.classList.add( "denoise" );
      denoiseSlider.value = 0.8;
      denoiseSlider.min = 0;
      denoiseSlider.max = 1;
      denoiseSlider.step = "any";
      denoiseSlider.style.position = "static";
      const updateDenoise =  ( {rect,current} ) => {
        let {x,y} = current;
        x -= rect.left; y -= rect.top;
        x /= rect.width; y /= rect.height;
        x = Math.max( 0, Math.min( 1, x ) );
        y = Math.max( 0, Math.min( 1, y ) );
        const p = x;
        denoiseSlider.value = parseFloat(denoiseSlider.min) + (parseFloat(denoiseSlider.max) - parseFloat(denoiseSlider.min))*p;
      };
      registerUIElement( denoiseSlider, { ondrag: updateDenoise } );
      uiControls.genControlElements.push( denoiseSlider );
      const denoiseHolder = document.createElement( "div" );
      denoiseHolder.classList.add( "img2img" );
      denoiseHolder.style = "position:relative; width:auto;";
      denoiseHolder.appendChild( document.createTextNode("Denoise") );
      denoiseHolder.appendChild( denoiseSlider );
      genControls.appendChild( denoiseHolder );
    }
    if( false ){
      //inpainting zoomed check
      const inpaintZoomed = document.createElement( "input" );
      inpaintZoomed.type = "checkbox"
      inpaintZoomed.classList.add( "inpaintZoomed" );
      //inpaintZoomed.checked = false;
      registerUIElement( inpaintZoomed, { onclick: () => { inpaintZoomed.checked = !inpaintZoomed.checked; } } );
      uiControls.genControlElements.push( inpaintZoomed );
      const inpaintZoomedHolder = document.createElement( "div" );
      inpaintZoomedHolder.classList.add( "img2img" );
      inpaintZoomedHolder.style = "position:relative; width:auto;";
      inpaintZoomedHolder.appendChild( document.createTextNode("Inpaint Zoomed") );
      inpaintZoomedHolder.appendChild( inpaintZoomed );
      genControls.appendChild( inpaintZoomedHolder );
    }
    {
      //controlnet lineart slider
      const lineartStength = document.createElement("input");
      lineartStength.type = "range";
      lineartStength.classList.add( "lineart" );
      lineartStength.value = 0.8;
      lineartStength.min = 0;
      lineartStength.max = 1;
      lineartStength.step = "any";
      lineartStength.style.position = "static";
      const updateLineartStrength =  ( {rect,current} ) => {
        let {x,y} = current;
        x -= rect.left; y -= rect.top;
        x /= rect.width; y /= rect.height;
        x = Math.max( 0, Math.min( 1, x ) );
        y = Math.max( 0, Math.min( 1, y ) );
        const p = x;
        lineartStength.value = parseFloat(lineartStength.min) + (parseFloat(lineartStength.max) - parseFloat(lineartStength.min))*p;
      };
      registerUIElement( lineartStength, { ondrag: updateLineartStrength } );
      uiControls.genControlElements.push( lineartStength );
      const lineartStrengthHolder = document.createElement( "div" );
      lineartStrengthHolder.classList.add( "lineart" );
      lineartStrengthHolder.style = "position:relative; width:auto;";
      lineartStrengthHolder.appendChild( document.createTextNode("Lineart Strength") );
      lineartStrengthHolder.appendChild( lineartStength );
      genControls.appendChild( lineartStrengthHolder );
    }

    genControls.style.display = "none";
    uiContainer.appendChild( genControls );

    

  }

  //the console
  const consoleElement = uiContainer.appendChild( document.createElement( "div" ) );
  consoleElement.id = "console";

  {
    //the undo/redo controls
    const undoButton = document.createElement( "button" );
    undoButton.className = "undo";
    undoButton.style.opacity = 0.25;
    undoButton.textContent = "Undo";
    registerUIElement( undoButton, { onclick: undo } );
    uiContainer.appendChild( undoButton );
    const redoButton = document.createElement( "button" );
    redoButton.className = "redo";
    redoButton.style.opacity = 0.25;
    redoButton.textContent = "Redo";
    registerUIElement( redoButton, { onclick: redo } );
    uiContainer.appendChild( redoButton );
  }

  {
    //the layer controls

    //the layers column
    const layersColumn = document.createElement("div");
    layersColumn.id = "layers-column";

    {
      //file controls
      const fileRow = document.createElement( "div" );
      fileRow.classList.add( "files" );
      {
        //save button
        const saveButton = document.createElement( "button" );
        saveButton.textContent = "Save";
        registerUIElement( saveButton, { onclick: () => saveJSON() } );
        fileRow.appendChild( saveButton );
      }
      {
        //open button
        const openButton = document.createElement( "button" );
        openButton.textContent = "Open";
        registerUIElement( openButton, { onclick: () => loadJSON() } );
        fileRow.appendChild( openButton );
      }
      {
        //export button
        const exportButton = document.createElement( "button" );
        exportButton.textContent = "Export";
        registerUIElement( exportButton, { onclick: () => exportPNG() } );
        fileRow.appendChild( exportButton );
      }

      layersColumn.appendChild( fileRow );
      //open button
      //export button
    }

    //add paint layer
    const addLayerButton = document.createElement( "button" );
    addLayerButton.textContent = "Add Paint Layer";
    registerUIElement( addLayerButton, { onclick: () => {
      if( selectedLayer ) addCanvasLayer( "paint", selectedLayer.w, selectedLayer.h, selectedLayer );
      else addCanvasLayer( "paint" );
    } } );
    layersColumn.appendChild( addLayerButton );
    //add gen layer
    const addGenLayerButton = document.createElement( "button" );
    addGenLayerButton.textContent = "Add Generative Layer";
    registerUIElement( addGenLayerButton, { onclick: () => {
      if( selectedLayer ) addCanvasLayer( "generative", selectedLayer.w, selectedLayer.h, selectedLayer );
      else addCanvasLayer( "generative" );
    } } );
    layersColumn.appendChild( addGenLayerButton );
    uiContainer.appendChild( layersColumn );

    //the node-link-dragging overlay
    const nodeDragOverlay = document.createElement( "div" );
    nodeDragOverlay.id = "node-drag-overlay";
    nodeDragOverlay.style.pointerEvents = "none";
    //the node drag overlay
    uiContainer.appendChild( nodeDragOverlay );

  }

  {
    //the air input placeholder
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

  {

    console.log( "Adding color wheel now..." );

    const updateColorWheelPreview = () => {
      const { h,s,l } = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl;
      baseColor.style.backgroundColor = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.colorStyle;
      colorPreview.style.backgroundColor = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.colorStyle;
      document.querySelector( ".paint-tools-options-color-well" ).style.backgroundColor = uiSettings.toolsSettings.paint.modeSettings.brush.colorModes.hsl.colorStyle;
  
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
      console.log( "Toggling visibility..." );
      //set position
      const r = document.querySelector( ".paint-tools-options-color-well" );
      colorWheel.style.top = `calc( ${r.top + r.height}px + 1rem )`;
      colorWheel.style.left = `calc( ${(r.left + r.right) / 2}px - ( var(--size) / 2 ) )`;
      if( colorWheel.classList.contains( "hidden" ) ) {
        colorWheel.classList.remove( "hidden" );
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
}

/* function makeHorizontalSlider( div, value=0.5, min=0, max=1, step=0.05 ) {
  const nub = div.appendChild( document.createElement( "div" ) );
  div.setAttribute( "value", value );
  div.setAttribute( "min", min );
  div.setAttribute( "max", max );
  div.setAttribute( "step", step );
  let sliding = false;
  div.addEventListener( "resize", () => {
    const r = div.getClientRects()[ 0 ];
    cnv.width = r.width * devicePixelRatio;
    cnv.height = r.height * devicePixelRatio;
  } );
  div.addEventListener( "pointerdown", p => {
    const x = p.offsetX;
    const value = x / cnv.width; //do I need the devicePixelRatio?
    nub.style.position.left = p.offsetX;
  } )
} */

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
    if( e.key === "ArrowRight" && selectedLayer ) {
      console.log( "here" );
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
    if( e.key === "ArrowDown" && selectedLayer ) {
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
    if( e.key === "ArrowUp" && selectedLayer ) {
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
    if( (e.key === "1" || e.key === "2") && selectedLayer ) {
      //let's upscale the layer a bit
      const origin = [0,0];
      //should actually recompute these using lw and lh, not my calculated distance or something
      const points = [ selectedLayer.topLeft, selectedLayer.bottomLeft, selectedLayer.bottomRight, selectedLayer.topRight ];
      for( const point of points ) {
        origin[0] += point[0];
        origin[1] += point[1];
      }
      origin[0] /=4;
      origin[1] /=4;
      const scale = (e.key === "1") ? 1.1 : 0.9;
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
  const ctx = layersStack.layers[0].context;
  const {w,h} = layersStack.layers[0];
  ctx.clearRect( 0, 0, w, h );

  const layersToDraw = [];
  for( const layer of layersStack.layers ) {
    if( layer.layerType === "paint-preview" ) continue;
    if( layer.visibility === false ) continue;
    layersToDraw.push( layer );
  }

  const layer0WidthPixels = layersToDraw[0].w;

  composeLayers( layersStack.layers[0], layersToDraw, layer0WidthPixels );

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

function saveJSON() {
  const uiSettingsSave = JSON.parse( JSON.stringify( uiSettings ) );
  const layersSave = [];
  for( const layer of layersStack.layers ) {
    if( layer.layerType === "paint-preview" ) continue;
    console.log( layer );
    //drop the canvas, context, glTexture... linkNodes??? ...Yeah. Those don't save right now.
    const {
      visible, layerType, opacity, w, h,
      topLeft, topRight, bottomLeft, bottomRight,
      /* textureChanged, textureChangedRect,
      maskChanged, maskChangedRect, maskInitialized, */
    } = layer;
    const saveImageDataURL = layer.canvas.toDataURL();
    let saveMaskDataURL = null;
    if( layer.maskInitialized ) saveMaskDataURL = layer.maskCanvas.toDataURL();
    layersSave.push( {
      visible, layerType, opacity, w, h,
      topLeft, topRight, bottomLeft, bottomRight,
      saveImageDataURL, saveMaskDataURL
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

        uiSettings = uiSettingsSave;
        Object.defineProperty( uiSettings, "paintColor", {
          get: function() {
            const {r,g,b} = uiSettings.paint;
            return `rgba(${r},${g},${b})`;
          }
        })
        uiSettings.nodeSnappingDistance = Math.min( innerWidth, innerHeight ) * 0.04; //~50px on a 1080p screen
      
        for( const layer of layersStack.layers ) {
          if( layer.layerType === "paint-preview" ) continue;
          deleteLayer( layer );
        }
        clearUndoHistory();
        
        for( const layer of layersSave ) {
          const newLayer = await addCanvasLayer( layer.layerType, layer.w, layer.h );
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
            visible, layerType, opacity, w, h,
            topLeft, topRight, bottomLeft, bottomRight,
          } = layer;
          newLayer.visible = visible;
          newLayer.layerType = layerType;
          newLayer.opacity = opacity;
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
      }
        
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
          const realPosition = Math.min( 95, Math.max( 5, valuePosition ) );
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
    if( pointers.count === 2 ) {
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
        if( cursor.mode !== "none" ) {
            if( cursor.mode === "ui" ) {
              cursor.inUIRect.activate();
              delete cursor.inUIRect;
            } else {
              finalizeViewMove();
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
            /* if( selectedLayer.layerType === "paint" || ( selectedLayer.layerType === "generative" && uiSettings.mask === true ) ) {
              if( true ) {
                finalizePaint( layersStack.layers[0], selectedLayer );
              }
              if( false ) {
                paintPointsToLayer( painter.queue, selectedPaintLayer );
                //clear the preview
                const paintPreviewLayer = layersStack.layers.find( l => l.layerType === "paint-preview" );
                paintPreviewLayer.context.clearRect( 0,0,paintPreviewLayer.w, paintPreviewLayer.h );
                paintPreviewLayer.textureChanged = true;
                paintPreviewLayer.textureChangedRect.x = 0;
                paintPreviewLayer.textureChangedRect.y = 0;
                paintPreviewLayer.textureChangedRect.w = paintPreviewLayer.w;
                paintPreviewLayer.textureChangedRect.h = paintPreviewLayer.h;
              }
            } */
            if( false && selectedPaintLayer ) {
              //finalize to canvas pixels
              /* getTransform();
              //Get our canvas coordinate system
              let [x,y] = transformPoint( selectedPaintLayer.topLeft ),
                [x2,y2] = transformPoint( selectedPaintLayer.topRight ),
                [x3,y3] = transformPoint( selectedPaintLayer.bottomLeft );
              x2 -= x; y2 -= y;
              x3 -= x; y3 -= y;
              const vxl = Math.sqrt( x2*x2 + y2*y2 ),
                vyl = Math.sqrt( x3*x3 + y3*y3 );
              const scale = selectedPaintLayer.w / vxl;
              x2 /= vxl; y2 /= vxl;
              x3 /= vyl; y3 /= vyl;
              const catx = selectedPaintLayer.context;
              catx.save();
              catx.beginPath();
              catx.lineCap = "round";
              catx.lineJoin = "round";
              catx.strokeStyle = uiSettings.paintColor;
              catx.lineWidth = uiSettings.brushSize;
              catx.globalAlpha = uiSettings.brushOpacity;
              if( uiSettings.brushBlur > 0 )
                catx.filter="blur(" + uiSettings.brushBlur + "px)";
              let move = true;
              for( const p of painter.queue ) {
                if( ! p ) continue;
                const [opx,opy] = transformPoint( p );
                const px = opx - x, py = opy - y;
                let dvx = px*x2 + py*y2,
                  dvy = px*x3 + py*y3;
                dvx *= scale;
                dvy *= scale;
                if( move ) {
                  move = false;
                  catx.moveTo( dvx, dvy );
                } else {
                  catx.lineTo( dvx, dvy );
                }
              }
              catx.stroke();
              catx.restore();
              //flag our gltexture for re-uploading
              selectedPaintLayer.textureChanged = true; */
            } else {
              //append to active vector art
              //disabled vector points
              /* demoPoints.push( null );
              for( const p of painter.queue )
                  demoPoints.push( p );
              demoPoints.push( null ); */
            }
            painter.queue.length = 0;
        }
    }
    if( pointers.count === 2 ) {
        //we should delete both to end the event.
        finalizeViewMove();
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
function updateCycle( t ) {
    if( pointers.count === 1 ) {
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
    if( pointers.count === 2 ) {

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

const _tpoint = [ 0 , 0 , 1 ],
    _transform = [
        1 , 0 , 0 ,
        0 , 1 , 0 ,
        0 , 0 , 1
    ]

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
    const [r,g,b] = brush.colorModes[brush.colorMode].rgbFloat;
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
  const colorStyle = settings.brush.colorModes[ settings.brush.colorMode ].colorStyle;
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
  //this isn't right, is it? You need the untransform?
  //matrix inversion works, but there's an obvious other way, right?
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

async function executeAPICall( name, controlValues ) {
  const apiFlow = apiFlows.find( flow => flow.apiFlowName === name );
  //for each control, set its value from the values
  //execute each apiCall in order
  const apiResults = {};
  for( apiCall of apiFlow.apiCalls ) {
    //process it and get results
    const results = {};
    const completedSuccessfully = await new Promise( async complete => {
      const xhr = new XMLHttpRequest();
      xhr.onload = async () => {
        let response;
        try { response = JSON.parse( xhr.response ); }
        catch ( e ) {
          console.error( "Not JSON. Alert api call failed. Response: ", xhr.response );
          complete( false );
        }
        for( const resultScheme of apiCall.results ) {
          const resultSuccessful = await new Promise( proceed => {
            const path = [ ...resultScheme.resultPath ];
            results[ resultScheme.name ] = response;
            while( path.length ) {
              if( typeof results[ resultScheme.name ] !== "object" ) {
                //path cannot be resolved
                console.error( "Unresolvable result path." );
                proceed( false );
              }
              const key = path.shift();
              results[ resultScheme.name ] = results[ resultScheme.name ][ key ];
            }
            //got result
            if( resultScheme.resultType === "base64-image" ) {
              const img = new Image();
              img.onload = () => {
                results[ resultScheme.resultName ] = img;
                proceed( true );
              }
              img.src = "data:image/png;base64," + results[ resultScheme.name ];
            }
            //non-image result types we can leave as-is for now
          } );
          if( resultSuccessful === false ) {
            console.error( "Unable to retrieve a result." );
            complete( false );
          }
        }
        //populated all results
        complete( true );
      }
      //load api values from controls
      for( const controlScheme of apiFlow.controls ) {
        if( controlScheme.controlPath[ 0 ] === apiCall.apiCallName ) {
          const [ , isApi, ...controlPath ] = controlScheme.controlPath;
          if( isApi === "api" ) {
            let target = apiCall.api;
            while( controlPath.length > 1 )
              target = target[ controlPath.shift() ];
            //controlpath is down to the last key
            //assign via corresponding name in controlValues object
            if( controlValues.hasOwnProperty( controlScheme.controlName ) )
              target[ controlPath.shift() ] = controlValues[ controlScheme.controlName ];
            else target[ controlPath.shift() ] = controlScheme.controlValue;
          }
        }
      }
      if( apiCall.host === "device" ) {
        if( apiCall.method === "POST" ) {
          const postData = {
            method: "POST",
            url: "http://127.0.0.1:"+ apiCall.port + apiCall.apiPath,
            path: apiCall.apiPath,//path: "/sdapi/v1/txt2img",
            host: '127.0.0.1',
            port: apiCall.port, //port: '7860',
            apiData: apiCall.api
          }
          xhr.open( "POST", "/api" );
          //apiCall.api has been modified from controlValues, and is ready to send
          xhr.send(new Blob([JSON.stringify(postData)],{"Content-Type":"application/json"}));
        }
      }
    } );
    if( completedSuccessfully === true ) {
      console.log( "Successfully completed apicall." );
      apiResults[ apiCall.apiCallName ] = results;
    }
    else if( completedSuccessfully === false ) {
      console.error( "Failed to complete apicall." );
      return false;
    }
  }
  console.log( "Got results: ", apiResults );
  const outputs = {};
  //successfully populated apiResults, or else returned error
  for( const outputScheme of apiFlow.outputs ) {
    const apiCallName = outputScheme.outputResultPath[ 0 ];
    const result = apiResults[ apiCallName ][ outputScheme.outputResultPath[ 1 ] ];
    outputs[ outputScheme.outputName ] = result;
  }
  return outputs;
}

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
        results: [
          //path to data in result, and descriptor of how to handle / datatype
        ],
        apiPath: "",
        api: {},
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
      { controlName: "width", controlType: "layer-input", layerPath: ["w"], controlValue:1024, controlPath: [ "i2i", "api", "width" ], },
      { controlName: "height", controlType: "layer-input", layerPath: ["h"], controlValue:1024, controlPath: [ "i2i", "api", "height" ], },

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