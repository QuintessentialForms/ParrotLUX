# ParrotLUX Documentation

## Table of Contents
- [Overview](#overview)
    - [Why A New Open-Source Painting App?](#why-a-new-open-source-painting-app)
    - [ParrotLUX's Core Technologies](#parrotluxs-core-technologies)
- [Using the App](#using-the-app)
    - [Installation](#installation)
    - [User Interface and Controls](#user-interface-and-controls)


## Overview

ParrotLUX is the first open-source, cross-platform, fully-featured painting app with a user interface is inspired by "invisible"-style interfaces like those of Procreate and Infinite Painter.
It has been designed from the ground up for conveniently using open source AI. 

### Why A New Open Source Painting App?

First, there are no open-source painting apps with invisible-style interfaces inspired by Procreate and Infinite Painter. This app aims to fill that gap. An invisible-style interface covers the device's entire display with nothing but the artwork. When the controls are not in use, they simply fade out of the artist's awareness. This helps produce a "flow" state while working, where the artist forgets about the technology and focuses completely on the art. (Redesigning the user interface of an existing open-source painting app like Krita to this extent would not be realistic or desirable. It would require modifying a majority of the app's codebase, a multi-year effort by the main development team to produce a feature most Krita users would ignore, and it would result in a fractured codebase--any subsequent development of the app would proceed slower.)

Second, ParrotLUX's intuitive integration with open-source AI is only possible because of a core technology called resolution-independent layer rendering. This technology is fundamentally incompatible with the layer-rendering technology available in open-source painting apps such as Krita and GIMP. While it is certainly possible to integrate open source AI with existing open source painting apps, that integration can never be convenient or intuitive. <i>(See a detailed explanation in the core technologies section below.)</i> It is unfortunately impossible to build ParrotLUX's AI interface on top of any *existing open-source painting app.

### ParrotLUX's Core Technologies
1. **Resolution-Independent Layer Rendering**
    - tldr; Normally, a painting app's layers all sit neatly inside one box that has a width and height in pixels. In ParrotLUX, you can move layers around freely with a pinch gesture and set each layer's width and height in pixels.
    - Why is this necessary? AI image generation requires careful resolution control because of how the underlying technology works. (For example, generating at 716x591 pixels is usually fundamentally impossible, and where it is possible, it will produce unusably bad results. One model might require generating at exactly 512x512 pixels for the best results, and another at 1024x1024, for example.) AI image generation also has practical resolution limits, because generating large images requires exponentially more resources than generating smaller images. E.g., if you would like to inpaint part of a 4K image there are two basic considerations: First, it is usually impractical to generate a 4K AI image. Secondly, selecting a small part of that image cannot be done arbitrarily. You must select a 1024x1024 or similarly precise area. What if the region you need to inpaint is not exactly 1024x1024 pixels? ParrotLUX solves this by assigning each layer its own dimensions, pixel density (scale relative to other layers), angle, and position on the canvas. This core technology makes convenient use of AI possible.
2. **Universal API Integration.** 
    - tldr; You can customize the app's controls to interact easily and conveniently with anything available over the Internet or running on a local machine.
    - The app's user interface integrates with custom-written APIFlows. These are generalized graph descriptors that describe to the app how to process and access Internet resources using data provided by the user interface. E.g., an APIFlow instructs the app to copy text from a "prompt" text-input into a field in a JSON structure, then POST that JSON structure to a server and port defined by the user in the app's settings. (This is an arbitrary example. APIFlows are universal--designed to enable connectivity to any resource.)

<i>*Technically, resolution-independent layers could be implemented in Blender and Inkscape. However, Blender has extremely unconventional art-tools, high system requirements, and lack of Android platform support. Inkscape lacks raster-layer (painting) support, and lacks Android platform support.</i>

## Using the App

### Installation

Install the app by using one of the packaged binaries provided in the main repository. Installers are available for Windows, Linux, and Android.  
The app is meant to be used on a device that has stylus input and touch-gestures. A keyboard is also recommended for writing text prompts, and keyboard shortcuts are available. Mouse input is also supported, but this is a painting app, and mouse input is generally considered too clunky for convenient painting.

### User Interface and Controls

### Tap and Drag Buttons

The app is primarily designed for stylus-use. Buttons are meant to be tapped. Sliders are meant to be tapped-and-dragged.

### Multitouch Pinch to View / Transform

The multi-touch pinch gesture is used to pan, zoom, and rotate the view. The view-control buttons in the bottom-left of the display can be used to reset the view, lock the zoom level, and lock the rotation angle. Depending on which locks are enabled, the pinch gesture might not zoom and might not rotate the view.

When using the transform tool, use the pinch gesture inside the boundary of a layer to move, scale, or rotate it. Only one touch-point needs to fall inside the layer. Use the pinch gesture outside the layer to pan, zoom, and rotate the view as normal.

### Non-Multitouch: Tap and Drag to View

On a device without multitouch, a keyboard is required to control the view.
- Stylus
    - Pan/Move: Hold `Space` and tap+drag the stylus (or mouse) to pan the view. When transforming, hold `Space` and tap+drag the stylus inside any of the selected layer(s) to move the selected layer(s).
    - Zoom/Scale: Hold `Ctrl+Space` and tap+drag the stylus (or mouse) to zoom the view. When transforming, hold `Ctrl+Space` and tap+drag the stylus inside any of the selected layer(s) to scale the selected layer(s).
    - Rotate: Hold `Shift+Space` and tap+drag the stylus (or mouse) to rotate the view. When transforming, hold `Shift+Space` and tap+drag the stylus inside any of the selected layer(s)to rotate the selected layer(s).
- Mouse (Middle-Click and Right-Click)
    - Pan/Move: Hold `Space` and left-click the mouse to pan the view. When transforming, hold `Space` and left-click the mouse inside any of the selected layer(s) to move the selected layer(s).
    - Zoom/Scale: Hold `Space` and middle-click the mouse to zoom the view. When transforming, hold `Space` and middle-click the mouse inside any of the selected layer(s) to move the selected layer(s).
    - Rotate: Hold `Space` and right-click the mouse to rotate the view. When transforming, hold `Space` and right-click the mouse inside any of the selected layer(s) to rotate the selected layer(s).

### Keyboard Shortcuts

Default keyboard shortcuts are available, such as `ctrl+z` to undo. Any action available in-app can be bound to a keyboard shortcut from the settings. Keyboard shortcut bindings can be imported, exported, and shared as *.json files.  

Default shortcuts include:  
- Undo `Ctrl+Z` 
- Redo `Ctrl+Shift+Z` or `Ctrl+Y`
- Pan `Space`
- Zoom `Shift+Space`
- Rotate `Ctrl+Space`
- Cancel / Close Dialogue `Escape`
- Apply / Accept `Enter` or `Ctrl+Enter`
- Air-Wheel `O`

## User Interface Areas

### Layers

Access layers using the column of layer-buttons on the right edge of the display.  
Hide or show the layer-buttons column using the hide/show layers button in the top-right of the display.  

Layer Button Layout  
Note: Any layer button control that makes a change to any layer(s) can be reversed using undo/redo, unless specifically stated otherwise.
- **Layer Button**: Tap the layer button to make it the sole selection, and to activate its layer-button controls. For a group-layer, tapping the layer button while it is activated will fold/unfold the group. (Layer selection and group folding/unfolding are not affected by undo/redo.)
- **Layer Type Icon**: A visual indicator of the layer's type, see the icons below. In the case of a layer-group, this icon can also be tapped to fold or unfold the group. (Group folding/unfolding is not affected by undo/redo.)
    - Generative
    - Paint
    - Vector
    - Text
    - Pose
    - Filter
    - Group
- **Visibility**: Tap to make the layer visible or invisible. (This setting is not affected by undo/redo.)
- **Alpha-lock**: (Paint layer only.) When locked, painting is only possible on parts of the layer already painted. Transparent parts of the layer will remain transparent. (This settings is not affected by undo/redo.)
- **Duplicate**: Tap to create a copy of the layer, inserted into the layer-buttons column directly above the duplicated layer. It will be auto-assigned the same name as the duplicated layer, with the word `copy` appended to the name.
- **Layer Name**: Tap to open a text box that allows renaming the layer. Use the keyboard or the on-screen keyboard to type a new name. Tapping the `X` in the top-left, or pressing the `Escape` key on the keyboard, will cancel the renaming operation without changing the layer's name. Tapping the check-mark in the bottom-right, or pressing `Enter` on the keyboard, will apply the newly typed layer-name.
- **Delete**: Tap to delete the layer.
- **Node Source**: Tap+Drag to link this layer to a generative input control, or to a filter layer's input.
- **Node Destination**: (Filter layer only.) Drag+Drop a link from another layer to make it the source for this filter layer.
- **Select**: Tap to add or remove this layer from the multi-layer selection.
- **Reorganize**: Tap+Drag to pop this layer out of the layer-buttons-column, then drop it in a new location to reorganize it relative to other layers. Layers organized at the top of the stack will display on top of layers organized at the bottom of the stack. (Imagine this as a stack of transparent sheets of paper.)
- **Layer Blend Mode**: Tap to open a popup for changing the layer's blend mode. Tap outside of the pop-up to close it. Tap one of the items in the pop-up's list to set that item as the layer's blend-mode. Four blend modes are included by default (listed below). Blend modes can be created, imported, and shared as *.json files from the settings panel, however, creating these involves knowledge of programming in a language called GLSL, as well as knowledge of the math involved in blending pixel colors.
    - Normal: The top-layer is blended normally with the bottom-layer (luminous power simulation, or root-mean-squared blending).
    - Multiply: The top-layer will darken the bottom-layer, while also tinting the bottom-layer with the top-layer's color. This might be useful for shadows.
    - Add: The top-layer will brighten the bottom-layer, while also tinting the bottom-layer with the top-layer's color. This might be useful for lighting and highlights.
    - Light & Shadow: The top-layer's dark colors will darken the bottom-layer, and the top-layer's bright colors will brighten the bottom-layer, both will also tint the bottom-layer with the top-layer's color. This might be useful for combining lighting and shadows on one layer.
- **Frame Index**: (Paint layer only.) These two numbers indicate which frame of the layer is currently being displayed, and how many total frames are stored in the layer. Tap to open the layer's frameline. Tap+Drag to scrub backward or forward along the layer's frameline (dragging to the left will show a lower-number frame, dragging to the right will show a higher-number frame.)
- **Generation History Index**: (Generative layer only.) These two numbers indicate which generation in the layer's history is currently being displayed, as well as how many total generations are stored in the layer's history. Tap to open the layer's generative history. Tap+Drag to scrub backward or forward along the layer's generative history (dragging to the left will show a lower-number generation, dragging to the right will show a higher-number generation.)
- **Opacity**: Tap+Drag to change the layer's opacity (transparency). Dragging all the way to the left will make the layer completely invisible. Dragging all the way to the right will make the layer as opaque as normal (although semi-transparent pixels in a paint layer will still be semi-transparent).
- **Convert to Paint Layer**: (Non-Paint layers only.) Tap to convert this layer to a paint layer. (This is necessary in order to merge the layer with other layers.)
- **Flatten Group**: (Group layer only.) Collapse all layers inside the group into a single paint layer.
- **Merge Layer Down**: (Paint layer only.) This button will only appear if there is another paint layer directly below the active paint layer. When merging down, the two layers will be combined into a single, new paint layer. The new paint layer will adopt the name of the bottom layer (the layer merged down onto). The name of the top layer will be discarded.

### Air-Wheel

To activate the air-wheel, use the stylus button, or press the letter `O` on the keyboard.

- color select
- undo/redo
- canvas controls
    - paint
    - mask
    - lasso
    - flood fill
    - color adjust

## Generative AI Tool

### Generative APIs
- explanation of gen layer purpose and functionality
- brief APIFlow description, link to section
- about controls (prompt, cfg, etc.) with links to other resources
- dragging nodes for i2i and cn input

### Single-Click AI Tools
- explantion of usage, creation, and sharing

## Canvas Tool
- explanation of layer interactions
- controls

### Canvas Paint Tool
### Canvas Mask Tool
### Canvas Lasso Tool
### Canvas Flood-Fill Tool
### Canvas Color-Adjust Tool

### Transform Tool
- explanation of transform purpose and functionality
- restate controls, inc. multitouch and mouse/pen

### Filter Tool

### Text Tool
- explanation of purpose and functionality
- controls

### Pose Tool
- explanation of pose layer purpose and functionality
- controls

### APIFlows
- explanation of API
- explanation of APIFlow purpose and functionality
- basic file-location use (+future)
- basic construction
    - name, controls, apicalls, variables, etc
- controltypes
- using the auto-make tool for Comfy

### Brushes
- basic design use
- importing / sharing