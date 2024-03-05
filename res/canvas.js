/* Working Proof of Concept:

    What next?
    Iterate! Don't optimize!
    
  The POC is done. It's actually totally usable.
  What's next? I have a list of alpha features.

  Next, I should start using it.
  The color wheel is usable, if not perfect. Have eyedropper too, no blend tho.
  Next:
    lineart is done and working, even with alpha stuff
    - next up is gen layer masking (basically for inpainting). hmm.

      Doesn't this also need something like visible -> img2img?
        No, we'll do layergroup -> img2img and ->lineart; but hold off on layergroups for now
    - layer controls mostly done? scroll? collapse?
    - blend is close but needs more work and not necessary (later)
    - fine-tune brush controls, including size preview while adjusting
    - no tap gestures, but air wheel needs controls added

*/
const VERSION = 3;

const main = document.createElement( "div" ),
  ui = document.createElement( "div" );
main.id = "main";
ui.id = "ui";

/* const cnv = document.createElement( "canvas" ),
  ctx = cnv.getContext( "2d" );
cnv.id = "cnv"; */

const gnv = document.createElement( "canvas" ),
gl = gnv.getContext( "webgl2", {premultipliedAlpha: false, alpha: false} );
gnv.id = "gnv";

let W = 0, H = 0;
let currentImage = null,
  //currentArtCanvas = null,
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
  document.querySelector( "button.undo" ).style.opacity = 1.0;
  redoHistory.length = 0;
  document.querySelector( "button.redo" ).style.opacity = 0.25;
  if( history.length > uiSettings.maxUndoSteps ) {
    const entry = history.shift();
    //entry.cleanup?.(); //no evident need for this?
  }
}
function undo() {
  if( history.length === 0 ) {
    document.querySelector( "button.undo" ).style.opacity = 0.25;
    return;
  };
  const entry = history.pop();
  entry.undo();
  redoHistory.push( entry );
  document.querySelector( "button.redo" ).style.opacity = 1.0;
  if( history.length === 0 ) {
    document.querySelector( "button.undo" ).style.opacity = 0.25;
  };
}
function redo() {
  if( redoHistory.length === 0 ) {
    document.querySelector( "button.redo" ).style.opacity = 0.25;
    return;
  };
  const entry = redoHistory.pop();
  entry.redo();
  history.push( entry );
  if( redoHistory.length === 0 ) {
    document.querySelector( "button.redo" ).style.opacity = 0.25;
  };
}

const linkedNodes = [];
let currentlyDragging = false,
  currentDraggingNode = null,
  currentDraggingLinkBase = null,
  currentDraggingLinkTerminal = null,
  currentDraggingLinkNub = null,
  currentDraggingDestination = null,
  currentDraggingDestinations = [];
function moveDrag({ rect, start, current, ending, starting, element }) {

  /* Continue here:
    on end, detect node rects for drop
    add a permanent link inside the layers column, which needs overflow-x visible.
    The layers column also needs to be a scrollable sub-section of the layers area.
    Don't perfect and refine yet. Just iterate toward a POC for now.
  */
  if( starting ) {

    const overlay = document.querySelector( "#node-drag-overlay" );
    
    currentDraggingNode = element;
  
    //if our node is a destination, delete its existing node (one link allowed per destination)
    for( let i=0; i<linkedNodes.length; i++ ) {
      const link = linkedNodes[ i ];
      if( link.destinationNode === currentDraggingNode ) {
        link.linkElement.parentElement.removeChild( link.linkElement );
        linkedNodes.splice( i, 1 );
        break;
      }
    }

    currentDraggingLinkBase = document.createElement( "div" );
    currentDraggingLinkBase.className = "node-link-base"
    overlay.appendChild( currentDraggingLinkBase );
    currentDraggingLinkTerminal = document.createElement( "div" );
    currentDraggingLinkTerminal.className = "node-link-terminal"
    overlay.appendChild( currentDraggingLinkTerminal );
  
    currentDraggingLinkNub = document.createElement( "div" );
    currentDraggingLinkNub.className = "node-link-nub";
    overlay.appendChild( currentDraggingLinkNub );
  
    //highlight the destinations
    currentDraggingDestinations.length = 0;
    const nodes = [ ...document.querySelectorAll( "div.link-node" ) ];
    for( const node of nodes ) {
      if( node.accept === element.emit ) {
        node.style.opacity = 1.0;
        if( node.id !== element.id ) {
          currentDraggingDestinations.push( node );
        }
      } else {
        node.style.opacity = 0.125;
      }
    }


    currentlyDragging = true;
  
  }

  const xOffset = 10 + linkedNodes.length * 5;

  let cursorX = current.x - xOffset,
    cursorY = current.y;

  const nodeRect = rect;

  let nodeX = nodeRect.left + nodeRect.width/2,
    nodeY = nodeRect.top + nodeRect.height/2;


  let snap = uiSettings.nodeSnappingDistance**2;
  currentDraggingDestination = null;
  for( const node of currentDraggingDestinations ) {
    const r = node.getClientRects()[0];
    if( ! r ) continue;
    const x = r.left - current.x,
      y = r.top - current.y;
    const d = ( x**2 + y**2 );
    if( d < snap ) {
      currentDraggingDestination = node;
      snap = d;
    }
    node.style.border = "0";
  }
  if( currentDraggingDestination ) {
    currentDraggingDestination.style.border = "2px solid var(--white)";
    const r = currentDraggingDestination.getClientRects()[0];
    cursorX = parseInt( r.left + r.width/2 );
    cursorY = parseInt( r.top + r.height/2 );
  }
  

  if( cursorX > nodeX - xOffset ) {
    cursorX = nodeX - xOffset;
  }

  let linkWidth = Math.abs( nodeX - cursorX ),
    linkHeight = Math.abs( nodeY - cursorY );

  const inverted = cursorY > nodeY;

  //top
  currentDraggingLinkTerminal.style.left = cursorX + "px";
  currentDraggingLinkTerminal.style.width = ( inverted ? linkWidth : xOffset ) + "px";
  currentDraggingLinkTerminal.style.top = ( inverted ? nodeY : cursorY ) + "px";
  currentDraggingLinkTerminal.style.height = (linkHeight/2 + 4) + "px";

  //bottom
  currentDraggingLinkBase.style.left = cursorX + "px";
  currentDraggingLinkBase.style.width = ( inverted ? xOffset : linkWidth ) + "px";
  currentDraggingLinkBase.style.top = (( inverted ? nodeY : cursorY ) + linkHeight/2) + "px";
  currentDraggingLinkBase.style.height = linkHeight/2 + "px";

  //nub
  currentDraggingLinkNub.style.left = (cursorX+xOffset - nodeRect.width/2) + "px";
  currentDraggingLinkNub.style.top = (cursorY - nodeRect.height/2) + "px";

  //compare to other nubs

  if( ending ) {

    if( ! currentlyDragging ) return;

    currentDraggingLinkBase?.parentElement.removeChild( currentDraggingLinkBase );
    currentDraggingLinkTerminal?.parentElement.removeChild( currentDraggingLinkTerminal );
    currentDraggingLinkNub?.parentElement.removeChild( currentDraggingLinkNub );

    if( currentDraggingDestination ) {
      
      //have valid destination; install the linked node
      const overlay = document.querySelector( "#node-drag-overlay" );
      
      const nodeLink = {};
      //paint emits an uplink that links up to generative
      if( currentDraggingNode.emit.indexOf( "uplink" ) > -1 ) {
        nodeLink.sourceNode = currentDraggingNode;
        nodeLink.destinationNode = currentDraggingDestination;
      } else {
        nodeLink.sourceNode = currentDraggingDestination;
        nodeLink.destinationNode = currentDraggingNode;
      }
      nodeLink.sourceLayer = nodeLink.sourceNode.layer;
      nodeLink.destinationLayer = nodeLink.destinationNode.layer;
      {
        //make the html
        //for the POC, we're just going to not worry about scrolling at all
        //all this code has to change anyway
        nodeLink.linkElement = document.createElement( "div" );
        nodeLink.linkElement.style = "position:absolute; left:0; top:0;";
        //neither of these has a UI handler, no worries
        nodeLink.linkElement.appendChild( currentDraggingLinkBase );
        nodeLink.linkElement.appendChild( currentDraggingLinkTerminal );
        //no need to keep the nub
        //nodeLink.linkElement.appendChild( currentDraggingLinkNub );
        overlay.appendChild( nodeLink.linkElement );
      }
  
      linkedNodes.push( nodeLink );

      if( selectedGenLayer ) selectLayer( selectedGenLayer.layerButton, selectedGenLayer );
  
    }
    currentDraggingNode = null;
    currentDraggingLinkBase = null;
    currentDraggingLinkTerminal = null;
    currentDraggingLinkNub = null;
    currentDraggingDestinations.length = 0;
    
    currentDraggingDestination = null;

    document.querySelectorAll( "div.link-node" ).forEach( n => n.style.opacity = 1.0 );

    currentlyDragging = false;

  }

}
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
  const newLayer = {
    //layerOrder: layersStack.layers.length, //not implemented
    visible: true,
    layerType,
    opacity:1.0,

    linkNodes: [],

    w:lw, h:lh,
    topLeft:tl,
    topRight:tr,
    bottomLeft:bl,
    bottomRight:br,

    canvas: document.createElement("canvas"),
    context: null,
    glTexture: null,
    textureChanged: false,
    textureChangedRect: {x:0,y:0,w:lw,h:lh},

    layerButton: null,
    mergeButton: null,

  }
  newLayer.canvas.width = lw;
  newLayer.canvas.height = lh;
  newLayer.context = newLayer.canvas.getContext( "2d" );
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

  let layerSibling,
    layerButton;
  if( layerType === "paint" || layerType === "generative" ) {
    //create the layer button
    layerButton = document.createElement( "div" );
    layerButton.className = "layer";
    layerButton.appendChild( newLayer.canvas );
    newLayer.layerButton = layerButton;
    registerUIElement( layerButton, { onclick: () => selectLayer( layerButton, newLayer ) } );

    //add the opacity slider
    {
      const opacitySlider = document.createElement("input");
      opacitySlider.type = "range";
      opacitySlider.className = "opacity";
      opacitySlider.value = 1;
      opacitySlider.min = 0;
      opacitySlider.max = 1;
      opacitySlider.step = 1/256;
      const updateOpacity =  ( {rect,current} ) => {
        let {x,y} = current;
        x -= rect.left; y -= rect.top;
        x /= rect.width; y /= rect.height;
        x = Math.max( 0, Math.min( 1, x ) );
        y = Math.max( 0, Math.min( 1, y ) );
        const p = x;
        opacitySlider.value = parseFloat(opacitySlider.min) + (parseFloat(opacitySlider.max) - parseFloat(opacitySlider.min))*p;
        newLayer.opacity = parseFloat(opacitySlider.value);
      };
      registerUIElement( opacitySlider, { ondrag: updateOpacity } );
      layerButton.appendChild( opacitySlider );
    }

    //the visibility button
    {
      const visibilityButton = document.createElement( "button" );
      visibilityButton.classList.add( "visibility" );
      visibilityButton.classList.add( "visible" );
      visibilityButton.textContent = "👁";
      registerUIElement( visibilityButton, { onclick: () => {
        newLayer.visible = !newLayer.visible;
        if( newLayer.visible ) visibilityButton.classList.add( "visible" );
        else visibilityButton.classList.remove( "visible" );
      } } );
      layerButton.appendChild( visibilityButton );
    }
    
    //the duplicate button
    {
      const duplicateButton = document.createElement( "button" );
      duplicateButton.classList.add( "duplicate" );
      duplicateButton.textContent = "📚";
      registerUIElement( duplicateButton, { onclick: async () => {
        //adding the new layer inherently adds the undo component
        const copy = await addCanvasLayer( layerType, lw, lh, newLayer )
        //by altering the properties without registering a new undo, the creation undo is a copy
        copy.context.drawImage( newLayer.canvas, 0, 0 );
        copy.textureChanged = true;
        copy.visible = newLayer.visible;
        copy.opacity = newLayer.opacity;
        copy.topLeft = [ ...newLayer.topLeft ];
        copy.topRight = [ ...newLayer.topRight ];
        copy.bottomLeft = [ ...newLayer.bottomLeft ];
        copy.bottomRight = [ ...newLayer.bottomRight ];
      } } );
      layerButton.appendChild( duplicateButton );
    }

    //the lineart button (temp, I think)
    {
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
    }

    //the delete button
    {
      const deleteButton = document.createElement( "button" );
      deleteButton.classList.add( "delete" );
      deleteButton.textContent = "🗑";
      registerUIElement( deleteButton, { onclick: async () => {

        //if this layer is selected, unselect it
        if( selectedGenLayer === newLayer ) selectedGenLayer = null;
        if( selectedPaintLayer === newLayer ) selectedPaintLayer = null;

        //delete from layer stack
        const index = layersStack.layers.indexOf( newLayer );
        layersStack.layers.splice( index, 1 );
        //remember the layer's parent and sibling in the DOM
        const domSibling = newLayer.layerButton.nextElementSibling,
          domParent = newLayer.layerButton.parentElement;
        //remove button from DOM
        domParent.removeChild( newLayer.layerButton );
        
        //add an undo entry
        const historyEntry = {
          index,
          newLayer,
          domSibling,
          undo: () => {
            //insert into the layer stack
            layersStack.layers.splice( historyEntry.index, 0, historyEntry.newLayer );
            //insert into the DOM
            domParent.insertBefore( historyEntry.newLayer.layerButton, historyEntry.domSibling );
          },
          redo: () => {
            //delete from the layer stack
            layersStack.layers.splice( historyEntry.index, 1 );
            //remove button from DOM
            domParent.removeChild(  historyEntry.newLayer.layerButton );
          }
        }
        recordHistoryEntry( historyEntry );

      } } );
      layerButton.appendChild( deleteButton );
    }

    //add the merge-down button
    {
      const mergeButton = document.createElement( "button" );
      mergeButton.className = "merge";
      mergeButton.textContent = "⬇";
      registerUIElement( mergeButton, { onclick: () => {
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
          selectLayer( lowerLayer.layerButton, lowerLayer );
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
              addLayerNodes( historyEntry.upperLayer );
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
      } } );
      newLayer.mergeButton = mergeButton;
      layerButton.appendChild( mergeButton );
      if( layerType === "paint" ) {
        //the merge button is only active on paint layers
        //also, the layer-select function will disable it if the layer immediately below is not a paint layer
        mergeButton.style = "";
        mergeButton.uiActive = true;
        const index = layersStack.layers.indexOf( newLayer );
        if( layersStack.layers[ index - 1 ]?.layerType === "paint" ) {
          mergeButton.classList.add( "enabled" );
          mergeButton.uiActive = true;
        } else {
          mergeButton.classList.remove( "enabled" );
          mergeButton.uiActive = false;
        }
      } else {
        mergeButton.style.display = "none";
        mergeButton.uiActive = false;
      }
    }

    //add the convert to paint layer button
    {
      const paintButton = document.createElement( "button" );
      paintButton.className = "paint";
      paintButton.textContent = "🖌️";
      registerUIElement( paintButton, { onclick: () => {

        newLayer.layerType = "paint";
        paintButton.style.display = "none";
        paintButton.uiActive = false;
        addLayerNodes( newLayer );
        selectLayer( newLayer.layerButton, newLayer );

        const historyEntry = {
          newLayer,
          undo: () => {
            historyEntry.newLayer.layerType = "generative";
            paintButton.style = "";
            paintButton.uiActive = true;
            addLayerNodes( historyEntry.newLayer );
          },
          redo: () => {
            historyEntry.newLayer.layerType === "paint";
            paintButton.style.display = "none";
            paintButton.uiActive = false;
            addLayerNodes( historyEntry.newLayer );
          }
        }
        recordHistoryEntry( historyEntry );

      } } );
      layerButton.appendChild( paintButton );
      if( layerType === "generative" ) {
        //the paint button is only active on generative layers
        paintButton.style = "";
        paintButton.uiActive = true;
      } else {
        paintButton.style.display = "none";
        paintButton.uiActive = false;
      }
    }

    //add the nodes holder and the node
    addLayerNodes( newLayer );

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
    selectLayer( layerButton, newLayer );
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


function addLayerNodes( layer ) {

  if( layer.layerType === "paint" || layer.layerType === "generative" ) {

    //get rid of the current nodes if we're changing this layer's format
    const existingNodesHolder = layer.layerButton.querySelector( "div.nodes-holder" );
    if( existingNodesHolder ) {
      existingNodesHolder.parentElement.removeChild( existingNodesHolder );
      for( const node of existingNodesHolder.querySelectorAll( ".link-node" ) ) {
        unregisterUIElement( node );
        //remove existing links
        for( let i = linkedNodes.length - 1; i >= 0; i-- ) {
          const link = linkedNodes[ i ];
          if( link.destinationNode === node ||
              link.sourceNode === node ) {
            link.linkElement.parentElement?.removeChild?.( link.linkElement );
            linkedNodes.splice( i, 1 );
          }
        }
      }
    }
    layer.linkNodes.length = 0;

    
    const nodesHolder = document.createElement("div");
    nodesHolder.className = "nodes-holder";
    nodesHolder.setAttribute("draggable","false");
    nodesHolder.draggable = false;
    layer.layerButton.appendChild( nodesHolder );
    const isNodes = [];
    if( layer.layerType === "paint" ) isNodes.push( "source" );
    if( layer.layerType === "generative" ) isNodes.push( "img2img", "lineart", /* "source" */ ); //gen needs source too of course
    for( const isNode of isNodes ) {
      const nodeId =
        [ {id:"link-node-0"}, ...document.querySelectorAll( "div.link-node" ) ].
          map(n=>n.id.substring(10)*1).
          reduce( (max,n) => Math.max(n,max) ) +
          1;
      const node = document.createElement( "div" );
      node.id = "link-node-" + nodeId;
      node.className = "link-node";
      node.setAttribute("draggable","false");
      node.draggable = false;
      node.accept = "none";
      node.emit = "none";
      node.isNode = isNode;
      node.layer = layer;
      if( layer.layerType === "paint" ) {
        node.emit = "image-uplink";
        node.accept = "image-downlink";
      }
      if( layer.layerType === "generative" ) {
        node.accept = "image-uplink";
        node.emit = "image-downlink";
      }
      nodesHolder.appendChild( node );
      registerUIElement( node, { ondrag: moveDrag } );
      layer.linkNodes.push( node );
    }
  }
}



function selectLayer( layerButton, layer ) {
  if( layer.layerType === "generative" ) {
    selectedPaintLayer = null;
    selectedGenLayer = layer;
    uiControls.hidePaintControls();
    uiControls.showGenControls();
    const genControls = document.querySelector( "#gen-controls" );
    //update gen controls for img2img
    genControls.classList.remove( "img2img" );
    genControls.classList.remove( "lineart" );
    for( const link of linkedNodes ) {
      if( link.destinationNode.layer === layer ) {
        if( link.destinationNode.isNode === "img2img" )
          genControls.classList.add( "img2img" );
        if( link.destinationNode.isNode === "lineart" )
          genControls.classList.add( "lineart" );
      } 
    }
  }
  if( layer.layerType === "paint" ) {
    selectedPaintLayer = layer;
    selectedGenLayer = null;
    uiControls.showPaintControls();
    uiControls.hideGenControls();
    //enable or disable the merge button
    const index = layersStack.layers.indexOf( layer );
    if( layersStack.layers[ index - 1 ]?.layerType === "paint" ) {
      layer.mergeButton.classList.add( "enabled" );
      layer.mergeButton.uiActive = true;
    } else {
      layer.mergeButton.classList.remove( "enabled" );
      layer.mergeButton.uiActive = false;
    }
  }
  for( const l of document.querySelectorAll( "#layers-column > .layer" ) ) {
    l.classList.remove( "active" );
  }
  layerButton.classList.add( "active" );
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
      if( selectedPaintLayer && painter.active && painter.queue.length > 1 ) {
        visibleLayers.splice( visibleLayers.indexOf( selectedPaintLayer )+1, 0, paintPreviewLayer );
      } else {
        visibleLayers.push( paintPreviewLayer );
      }

      getTransform();

      for( const layer of visibleLayers ) {

        //eraser preview requires real layer undrawn
        if( layer === selectedPaintLayer &&
            uiSettings.brush === "erase" &&
            painter.active &&
            painter.queue.length > 1 )
          continue;

        if( layer === paintPreviewLayer ) {
          if( uiSettings.brush === "paint" )
            layer.opacity = uiSettings.brushOpacity;
          if( uiSettings.brush === "erase" )
            layer.opacity = selectedPaintLayer.opacity;
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

        //set the layer's alpha
        gl.uniform1f( glState.alphaInputIndex, layer.opacity );

        //set the uniform to point at texture zero
        gl.uniform1i( gl.getUniformLocation( glState.program, "img" ), 0 );
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
    main.appendChild( ui );

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

    window.addEventListener( "keydown" , e => keyHandler( e , true ) );
    window.addEventListener( "keyup" , e => keyHandler( e , false ) );

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
    uniform float alpha;
    in vec2 uv;
    out vec4 outColor;
    
    void main() {
      vec4 lookup = texture(img,uv);
      lookup.a *= alpha;
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

    console.log(gl.getProgramInfoLog(program));
    
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
    uiSettings.paint.r = airInput.color[ 0 ];
    uiSettings.paint.g = airInput.color[ 1 ];
    uiSettings.paint.b = airInput.color[ 2 ];
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
  maxUndoSteps: 20,
  paint: { r:200,g:220,b:240 },
  get paintColor(){
    const {r,g,b} = uiSettings.paint;
    return `rgb(${r},${g},${b})`;
  },
  brush: "paint",
  pressureEnabled: true,
  //brushEngine: "pencil",
  brushEngine: "pencil",
  brushTiltScaleAdd: 20.0,
  brushSize: 14,
  brushOpacity: 1,
  brushBlur: 0,
  brushProfile: p => uiSettings.brushSize,

  nodeSnappingDistance: Math.min( innerWidth, innerHeight ) * 0.04, //~50px on a 1080p screen

}

const uiControls = {
  paintControlElements: [],
  hidePaintControls: () => {
    document.querySelector( "#paint-controls" ).style.display = "none";
    uiControls.paintControlElements.forEach( e => e.uiActive = false );
  },
  showPaintControls: () => {
    document.querySelector( "#paint-controls" ).style.display = "block";
    uiControls.paintControlElements.forEach( e => e.uiActive = true );
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

}

function setupUI() {
  
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
  ui.appendChild( button );

  {
    //the paint controls

    const paintControls = document.createElement( "div" );
    paintControls.id = "paint-controls";
    ui.appendChild( paintControls );
  
    //the brushsize slider
    const brushSizeSlider = document.createElement("input");
    brushSizeSlider.type = "range";
    brushSizeSlider.classList.add( "brush-size" );
    brushSizeSlider.classList.add( "vertical" );
    brushSizeSlider.value = uiSettings.brushSize;
    brushSizeSlider.min = 0.1;
    brushSizeSlider.max = 128;
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
      uiSettings.brushSize = parseFloat(brushSizeSlider.value);
    };
    registerUIElement( brushSizeSlider, { ondrag: updateSize } );
    uiControls.paintControlElements.push( brushSizeSlider );
    paintControls.appendChild( brushSizeSlider );
  
    
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
      uiSettings.brushOpacity = parseFloat(brushOpacity.value);
    };
    registerUIElement( brushOpacity, { ondrag: updateOpacity } );
    uiControls.paintControlElements.push( brushOpacity );
    paintControls.appendChild( brushOpacity );
  
    //the brush opacity slider
    const brushBlur = document.createElement("input");
    brushBlur.type = "range";
    brushBlur.classList.add( "brush-blur" );
    brushBlur.classList.add( "vertical" );
    brushBlur.value = uiSettings.brushBlur;
    brushBlur.min = 0;
    brushBlur.max = 10;
    brushBlur.step = "any";
    brushBlur.setAttribute( "orient", "vertical" );
    brushBlur.orient = "vertical";
    brushBlur.style.appearance = "slider-vertical";
    const updateBlur = ( {rect,current} ) => {
      let {x,y} = current;
      x -= rect.left; y -= rect.top;
      x /= rect.width; y /= rect.height;
      x = Math.max( 0, Math.min( 1, x ) );
      y = Math.max( 0, Math.min( 1, y ) );
      const p = 1 - y;
      brushBlur.value = parseFloat(brushBlur.min) + (parseFloat(brushBlur.max) - parseFloat(brushBlur.min))*p;
      uiSettings.brushBlur = parseFloat(brushBlur.value);
    };
    registerUIElement( brushBlur, { ondrag: updateBlur } );
    uiControls.paintControlElements.push( brushBlur );
    paintControls.appendChild( brushBlur );
    
    //the color palette
    const colorPalette = document.createElement( "div" );
    colorPalette.classList.add( "palette" );
    for( const r of [0,128,255] ) {
      for( const g of [0,128,255] ) {
        for( const b of [0,128,255 ] ) {
          const color = document.createElement( "button" );
          color.classList.add( "color" );
          color.style.backgroundColor = `rgb(${r},${g},${b})`;
          registerUIElement( color, { onclick: () => {
              console.log( "here" );
              uiSettings.paint.r = r;
              uiSettings.paint.g = g;
              uiSettings.paint.b = b;
              uiSettings.brush = "paint";
            }
          } );
          uiControls.paintControlElements.push( color );
          colorPalette.appendChild( color );
        }
      }
    }
    const eraser = document.createElement( "button" );
    eraser.classList.add( "eraser" );
    registerUIElement( eraser, { onclick: () => uiSettings.brush = "erase" } );
    uiControls.paintControlElements.push( eraser );
    colorPalette.appendChild( eraser );
    paintControls.appendChild( colorPalette );

    {
      //the colorwheel summoner
      const colorWell = document.createElement( "div" );
      colorWell.classList.add( "color-well" );
      colorWell.style.backgroundColor = uiSettings.paintColor;
      let open = false;
      registerUIElement( colorWell, { onclick: () => {
        colorWheel.style.display = ( open = !open ) ? "block" : "none";
        colorWheel.uiActive = open;
        colorWell.style.backgroundColor = uiSettings.paintColor;
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

      if( genControls.classList.contains( "img2img" ) ) {
        //lets find the image
        const layer = selectedGenLayer;
        for( const link of linkedNodes ) {
          if( link.destinationNode.isNode === "img2img" &&
              link.destinationLayer === layer ) {
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

      let usingLineart = false,
        lineartStrength = 0

      if( genControls.classList.contains( "lineart" ) ) {
        //lets find the source lineart canvas
        const layer = selectedGenLayer;
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
      const img = await getImageA1111( { api, prompt:p, img2img, denoise } );
      selectedGenLayer.context.drawImage( img, 0, 0 );
      selectedGenLayer.textureChanged = true;
      selectedGenLayer.textureChangedRect.x = 0;
      selectedGenLayer.textureChangedRect.y = 0;
      selectedGenLayer.textureChangedRect.w = selectedGenLayer.w;
      selectedGenLayer.textureChangedRect.h = selectedGenLayer.h;
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

    

    //the console
    const consoleElement = ui.appendChild( document.createElement( "div" ) );
    consoleElement.id = "console";

  }

  {
    //the undo/redo controls
    const undoButton = document.createElement( "button" );
    undoButton.className = "undo";
    undoButton.style.opacity = 0.25;
    undoButton.textContent = "Undo";
    registerUIElement( undoButton, { onclick: undo } );
    ui.appendChild( undoButton );
    const redoButton = document.createElement( "button" );
    redoButton.className = "redo";
    redoButton.style.opacity = 0.25;
    redoButton.textContent = "Redo";
    registerUIElement( redoButton, { onclick: redo } );
    ui.appendChild( redoButton );
  }

  {
    //the layer controls

    //the layers column
    const layersColumn = document.createElement("div");
    layersColumn.id = "layers-column";

    if( true ) {
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
      const selectedLayer = selectedPaintLayer || selectedGenLayer;
      if( selectedLayer ) addCanvasLayer( "paint", selectedLayer.w, selectedLayer.h, selectedLayer );
      else addCanvasLayer( "paint" );
    } } );
    layersColumn.appendChild( addLayerButton );
    //add gen layer
    const addGenLayerButton = document.createElement( "button" );
    addGenLayerButton.textContent = "Add Generative Layer";
    registerUIElement( addGenLayerButton, { onclick: () => {
      const selectedLayer = selectedPaintLayer || selectedGenLayer;
      if( selectedLayer ) addCanvasLayer( "generative", selectedLayer.w, selectedLayer.h, selectedLayer );
      else addCanvasLayer( "generative" );
    } } );
    layersColumn.appendChild( addGenLayerButton );
    ui.appendChild( layersColumn );

    //the node-link-dragging overlay
    const nodeDragOverlay = document.createElement( "div" );
    nodeDragOverlay.id = "node-drag-overlay";
    nodeDragOverlay.style.pointerEvents = "none";
    //the node drag overlay
    ui.appendChild( nodeDragOverlay );

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
    ui.appendChild( airInputElement );
  }

  const updateColorWheelPreview = () => {
    const [h,s,l] = rgbToHsl( uiSettings.paint.r, uiSettings.paint.g, uiSettings.paint.b );
    const [r,g,b] = hslToRgb( h, 1, 0.5 );
    baseColor.style.backgroundColor = `rgb(${r},${g},${b})`;

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


    colorPreview.style.backgroundColor = uiSettings.paintColor;
  }

    //color well's shared controls need these references
    let colorWheel, baseColor, colorPreview,
      colorNubs = { h:null, s:null, l:null };

  {
    //the colorwheel panel
    colorWheel = document.createElement( "div" );
    colorWheel.classList = "color-wheel";
    registerUIElement( colorWheel, { onclick: () => {
      colorWheel.style.dispay = "none";
      colorWheel.uiActive = false;
    } } );
    baseColor = document.createElement( "div" );
      baseColor.className = "base-color";
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
    for( const k in colorNubs ) {
      const nub = document.createElement( "div" );
      nub.className = "color-nub";
      colorNubs[ k ] = nub;
      nubOverlay.appendChild( nub );
    }
    colorPreview = document.createElement( "div" );
      colorPreview.className = "color-preview";
      colorWheel.appendChild( colorPreview );
    colorWheel.style.display = "none";
    //registerUIElement( colorWheel click exits colorwheel without change )
    let draggingIn = null;
    registerUIElement( base, { ondrag:
      ({ rect, start, current, ending, starting, element }) => {
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
          let {r,g,b} = uiSettings.paint,
            [h,s,l] = rgbToHsl(r,g,b),
            updated = false;

          if( draggingIn === "saturationRing" ) {
            const at = Math.min( 1, Math.max( 0, 1 - (( Math.abs(ang) - 0.45 ) / (2.71-0.45)) ) );
            [r,g,b] = hslToRgb( h,at,l );
            updated = true;
          }
          else if( draggingIn === "luminosityRing" ) {
            const at = Math.min( 1, Math.max( 0, 1 - (( Math.abs(ang) - 0.45 ) / (2.71-0.45)) ) );
            [r,g,b] = hslToRgb( h,s,at );
            updated = true;
          }
          else if( draggingIn === "hueRing" ) {
            //normalize angle
            const nang = ( ang + Math.PI ) / (Math.PI*2);
            [r,g,b] = hslToRgb( nang,s,l );
            updated = true;
          }

          if( updated ) {
            uiSettings.paint.r = r;
            uiSettings.paint.g = g;
            uiSettings.paint.b = b;
            updateColorWheelPreview();
          }

        }


      }
    } ); 
    ui.appendChild( colorWheel );
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
function keyHandler( e , state ) {
    if( document.activeElement?.tagName === "INPUT" ) {
      return;
    }
    if( ! ["F5","F12"].includes( e.key ) )
      e.preventDefault?.();
    keys[ e.key ] = state;
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
  }
}

function exportPNG() {
  //TODO: calculate the bounding box of all layers and resize the export canvas
  const ctx = layersStack.layers[0].context;
  const {w,h} = layersStack.layers[0];
  ctx.clearRect( 0, 0, w, h );

  for( let i=1; i<layersStack.layers.length; i++ ) {
    const layer = layersStack.layers[i];
    if( layer.visible && layer.opacity > 0 ) {
      //TODO: orient the layer with its coordinates relative to the export bounding box
      ctx.drawImage( layer.canvas, 0, 0 );
    }
  }

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
    if( layer.type === "paint-preview" ) continue;
    console.log( layer );
    //drop the canvas, context, glTexture... linkNodes??? ...Yeah. Those don't save right now.
    const {
      visible, layerType, opacity, w, h,
      topLeft, topRight, bottomLeft, bottomRight,
      textureChanged, textureChangedRect
    } = layer;
    const saveImageDataURL = layer.canvas.toDataURL();
    layersSave.push( {
      visible, layerType, opacity, w, h,
      topLeft, topRight, bottomLeft, bottomRight,
      textureChanged, textureChangedRect,
      saveImageDataURL
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
  fileInput.style.display = "position:absolute; left:0; top:0; opacity:0;";
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
      
        layersStack.layers.length = 1;
        for( const layer of layersSave ) {
          const newLayer = await addCanvasLayer( layer.layerType, layer.w, layer.h );
          console.log( "Got new layer: ", newLayer );
          const img = new Image();
          img.onload = () => {
            newLayer.context.drawImage( img, 0, 0 );
            newLayer.textureChanged = true;
          }
          img.src = layer.saveImageDataURL;
          const {
            visible, layerType, opacity, w, h,
            topLeft, topRight, bottomLeft, bottomRight,
            textureChanged, textureChangedRect
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
function registerUIElement( element, events ) {
  uiElements.set( element, events );
  element.uiActive = true;
}
function unregisterUIElement( element ) {
  uiElements.delete( element );
  element.uiActive = false;
}

function testUIElements( p ) {
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
}

let info = "";

const contextMenuHandler = p => {
  //info += "C";
  cancelEvent( p );
}
const startHandler = p => {

    cancelEvent( p );

    if( p.pressure > 0 ) {
      const caughtByUI = testUIElements( p );
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
        else if( p.pointerType !== "touch" && selectedPaintLayer ) {
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
    
    if( uiHandlers[ p.pointerId ] )
      return uiHandlers[ p.pointerId ].move( p );

    const x = p.offsetX * window.devicePixelRatio,
        y = p.offsetY * window.devicePixelRatio;
    if( pointers.count === 1 ) {
        if( cursor.mode !== "none" ) {
            cursor.current.x = x;
            cursor.current.y = y;
        }
        if( painter.active === true ) {
            const point = [ x , y , 1, p.pressure, p.tiltX, p.tiltY ];
            
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

  return false;

}
const stopHandler = p => {
    cancelEvent( p );

    if( uiHandlers[ p.pointerId ] ) {
      uiHandlers[p.pointerId].end( p );
      delete uiHandlers[ p.pointerId ];
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
            if( selectedPaintLayer ) {
              if( true ) {
                finalizePaint( layersStack.layers[0], selectedPaintLayer );
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
            }
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

const paintCanvases = {
  tip: null,
  blend: null,
  blendSource: null,
  modRect: {x:0,y:0,x2:0,y2:0,w:0,h:0},
  firstPaint: false,
}
function beginPaint() {

  if( ! paintCanvases.tip ) {
    const canvas = document.createElement( "canvas" ),
      context = canvas.getContext( "2d" );
    paintCanvases.tip = { canvas, context };
    //document.body.appendChild( canvas );
    canvas.style = "position:absolute; left:110px; top:10px; width:100px; height:100px; border:1px solid red; pointer-events:none;";
  }
  if( ! paintCanvases.blend ) {
    const canvas = document.createElement( "canvas" ),
      context = canvas.getContext( "2d" );
    paintCanvases.blend = { canvas, context };
    //document.body.appendChild( canvas );
    canvas.style = "position:absolute; left:110px; top:120px; width:100px; height:100px; border:1px solid red; pointer-events:none;";
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

  console.error( "beginPaint() needs to redim the paintPreviewLayer to match the target layer.")

  //reset and activate the painter
  painter.queue.length = 0;
  painter.active = true;

  //when erasing, copy active layer to preview
  if( uiSettings.brush === "erase" ) {
    const ptx = layersStack.layers[0].context;
    ptx.save();
    ptx.clearRect( 0,0,selectedPaintLayer.w,selectedPaintLayer.h );
    ptx.globalCompositeOperation = "copy";
    ptx.drawImage( selectedPaintLayer.canvas, 0, 0 );
    ptx.restore();
  }

  //build the brush tip
  {
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
  }
  //prep the blend blitter
  {
    const {canvas,context} = paintCanvases.blend;
    //distended shape not yet implemented
    const w = canvas.width = paintCanvases.tip.canvas.width;
    const h = canvas.height = paintCanvases.tip.canvas.height;
    context.save();
    context.clearRect( 0,0,w,h );
    paintCanvases.firstPaint = true;
    if( uiSettings.brushEngine !== "blend" ) {
      context.fillStyle = uiSettings.paintColor;
      context.fillRect( 0,0,w,h );
      context.globalCompositeOperation = "destination-in";
      context.drawImage( paintCanvases.tip.canvas, 0, 0 );
    }
    context.restore();
  }
  //preb the blend source
  if( uiSettings.brushEngine === "blend" ) {
    const {canvas,context} = paintCanvases.blendSource;
    //distended shape not yet implemented
    const w = canvas.width = selectedPaintLayer.canvas.width;
    const h = canvas.height = selectedPaintLayer.canvas.height;
    context.drawImage( selectedPaintLayer.canvas, 0, 0 );
  }

}
function finalizePaint( strokeLayer, paintLayer ) {
  const ctx = paintLayer.context;

  const mr = paintCanvases.modRect;

  let oldCanvasData;

  let mx = Math.max( 0, mr.x - mr.w*0.25 ),
    my = Math.max( 0, mr.y - mr.h*0.25 ),
    mw = Math.min( 1024, mr.w*1.5 ),
    mh = Math.min( 1024, mr.h*1.5 );

  //get data for our affected region
  if( paintLayer.layerType === "paint" ) {
    oldCanvasData = ctx.getImageData( mx, my, mw, mh );
  }

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = uiSettings.brushOpacity;
  if( uiSettings.brush === "erase" ) {
    //eraser has a copy of the paint layer
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = "copy";
  }
  ctx.drawImage( strokeLayer.canvas, 0, 0 );
  ctx.restore();

  //get our new data and record an undo event
  if( paintLayer.layerType === "paint" ) {
    const newCanvasData = ctx.getImageData( mx, my, mw, mh );
    const historyEntry = {
      paintLayer,
      oldCanvasData,
      newCanvasData,
      x: mx, y: my,
      w: mw, h: mh,
      undo: () => {
        historyEntry.paintLayer.context.putImageData( historyEntry.oldCanvasData, historyEntry.x, historyEntry.y );
        historyEntry.paintLayer.textureChanged = true;
        historyEntry.paintLayer.textureChangedRect.x = historyEntry.x;
        historyEntry.paintLayer.textureChangedRect.y = historyEntry.y;
        historyEntry.paintLayer.textureChangedRect.w = historyEntry.w;
        historyEntry.paintLayer.textureChangedRect.h = historyEntry.h;
      },
      redo: () => {
        historyEntry.paintLayer.context.putImageData( historyEntry.newCanvasData, historyEntry.x, historyEntry.y );
        historyEntry.paintLayer.textureChanged = true;
        historyEntry.paintLayer.textureChangedRect.x = historyEntry.x;
        historyEntry.paintLayer.textureChangedRect.y = historyEntry.y;
        historyEntry.paintLayer.textureChangedRect.w = historyEntry.w;
        historyEntry.paintLayer.textureChangedRect.h = historyEntry.h;
      }
    }
    recordHistoryEntry( historyEntry );
  }

  //clear the preview
  strokeLayer.context.clearRect( 0,0, strokeLayer.w, strokeLayer.h );

  //flag the paintlayer for GPU upload
  paintLayer.textureChanged = true;
  paintLayer.textureChangedRect.x = mr.x;
  paintLayer.textureChangedRect.y = mr.y;
  paintLayer.textureChangedRect.w = mr.w;
  paintLayer.textureChangedRect.h = mr.h;

  //flag the previewlayer for GPU upload
  strokeLayer.textureChanged = true;
  strokeLayer.textureChangedRect.x = mr.x;
  strokeLayer.textureChangedRect.y = mr.y;
  strokeLayer.textureChangedRect.w = mr.w;
  strokeLayer.textureChangedRect.h = mr.h;

}
function applyPaintStroke( points, layer ) {
  if( points.length < 2 ) return;
  //for now, not slerping vectors, just a line from a to b
  let [bx,by,b_,bp,btx,bty] = points[ points.length-1 ],
    [ax,ay,a_,ap,atx,aty] = points[ points.length-2 ];

  //transform our basis points  
  getTransform();

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

  let [otax,otay] = transformPoint( [ax,ay,1] ),
    [otbx,otby] = transformPoint( [bx,by,1] );
  otax -= x; otay -= y;
  let tax = otax*x2 + otay*y2,
    tay = otax*x3 + otay*y3;
  tax *= scale;
  tay *= scale;
  otbx -= x; otby -= y;
  let tbx = otbx*x2 + otby*y2,
    tby = otbx*x3 + otby*y3;
  tbx *= scale;
  tby *= scale;

  //ta[xy] and tb[xy] are the two point coordinates on our canvas where we're painting.
  
  //count our paint pixels
  const pixelSpacing = Math.max( 1, uiSettings.brushBlur );
  const lineLength = Math.max( 2, parseInt( Math.sqrt( (tax-tbx)**2 + (tay-tby)**2 ) / pixelSpacing ) + 1 );

  const pencilDistentionScale = uiSettings.brushTiltScaleAdd;

  //update / expand our paint bounds rectangle
  const mr = paintCanvases.modRect;
  mr.x = parseInt( Math.min( mr.x, tax - uiSettings.brushSize - uiSettings.brushBlur, tbx - uiSettings.brushSize - uiSettings.brushBlur ) );
  mr.y = parseInt( Math.min( mr.y, tay - uiSettings.brushSize - uiSettings.brushBlur, tby - uiSettings.brushSize - uiSettings.brushBlur ) );
  mr.x2 = parseInt( Math.max( mr.x2, tax + uiSettings.brushSize + uiSettings.brushBlur, tbx + uiSettings.brushSize + uiSettings.brushBlur ) );
  mr.y2 = parseInt( Math.max( mr.y2, tay + uiSettings.brushSize + uiSettings.brushBlur, tby + uiSettings.brushSize + uiSettings.brushBlur ) );
  mr.w = mr.x2 - mr.x;
  mr.h = mr.y2 - mr.y;

  //we're never collecting undo data during this paint function, because finalization is done by blitting the paint layer, not by repainting.

  const ctx = layer.context,
    cnv = layer.canvas;

  //okay! Let's paint the line
  if( uiSettings.brushEngine === "pencil" || uiSettings.brushEngine === "blend" ) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    if( uiSettings.brush === "erase" )
      ctx.globalCompositeOperation = "destination-out";
    const tip = paintCanvases.tip.canvas,
      blend = paintCanvases.blend.canvas,
      tw = tip.width, th = tip.height;
    for( let i=0; i<lineLength; i++ ) {

      //So slow :-| but not optimizing (plus, we're clamped to two points now)
      const f = i/lineLength, fi = 1 - f;
      let lx = tbx*f + tax*fi,
      ly = tby*f + tay*fi,
      p = bp*f + ap*fi,
      tiltX = btx*f + atx*fi,
      tiltY = bty*f + aty*fi,
      tiltScale = 1 + (( Math.sqrt( tiltX**2 + tiltY**2 ) / 127 )**2) * pencilDistentionScale;
      //lx and ly are the two points on our canvas where we're blitting the paint-image.
      if( uiSettings.pressureEnabled === false ) {
        p = 1;
        tiltX = 0;
        tiltY = 0;
        tiltScale = 1;
      }

      //start by grabbing from our paint canvas for blend
      if( uiSettings.brushEngine === "blend" && paintCanvases.firstPaint === true ) {
        const context = paintCanvases.blend.context;
        const w = paintCanvases.blend.canvas.width,
          h = paintCanvases.blend.canvas.height;
        context.save();
        paintCanvases.firstPaint = false;
        //grab blend source pixels
        context.clearRect( 0, 0, w, h );
        context.globalCompositeOperation = "copy";
        context.globalAlpha = 1.0;
        context.drawImage( paintCanvases.blendSource.canvas, -lx - w/2, -ly - h/2 );
        //mask with tip
        context.globalAlpha = 1.0;
        context.globalCompositeOperation = "destination-in";
        context.drawImage( paintCanvases.tip.canvas, 0, 0 );
        context.restore();
      }

      ctx.save();
      ctx.translate( lx, ly );
      //LOL this is stupidly wrong, but it's *exactly* what Infinite Painter implemented. And it works great there. :-)
      ctx.rotate( Math.atan2( tiltY, tiltX ) );
      ctx.scale( tiltScale, 1 ); //pencil tilt shape
      ctx.translate( (tw/2) / tiltScale, 1 );

      //opacity is applied at the brush-level while erasing??? Hmm.
      //if( uiSettings.brush === "erase" ) ctx.globalAlpha = p * uiSettings.brushOpacity;

      ctx.globalAlpha = p; //pencil pressure darkness
      //Okay... So here, for 
      ctx.drawImage( blend, -tw/2, -th/2, tw, th );
      ctx.restore();

    }
    ctx.restore();
  }

  layer.textureChanged = true;
  layer.textureChangedRect.x = mr.x;
  layer.textureChangedRect.y = mr.y;
  layer.textureChangedRect.w = mr.w;
  layer.textureChangedRect.h = mr.h;

}

function paintPointsToLayer( points, layer ) {

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

}

//I think this is never called?
function stroke( points ) {
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


async function getImageA1111( {api="txt2img", prompt, seed=-1, sampler="DPM++ SDE", steps=4, cfg=1, width=1024, height=1024, CADS=false, img2img=null, denoise=0.8 } ) {
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

setup();