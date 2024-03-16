# Tempera
A Pen-Tablet Painting App for Open-Source AI

**Currently pre-alpha!** Supports Android tablets. May support iPad.

# Paint + AI = Magic
Do you want the power and convenience of a modern touchscreen-tablet painting app combined with easy text-to-image, image-to-image, and controlnet?  
Tempera is an open-source art app, built around open-source AI, designed for artists.

Run Stable Diffusion on your PC using A1111 or Comfy, and connect to it via the art app on your tablet. Alternatively, run literally any other platform on any device or in the cloud. Tempera supports all network-based APIs by implementing a universal, user-customizable APIFlow system. Create, download, and share APIFlows complete with sleek in-app controls.

**But, again, it's currently in pre-alpha!** Please be patient for all the awesomeness to come.

## Beautiful Painting Workflow & Interface
The sleek multi-touch interface and fine-tuned brush controls match standard painting apps for art tablets. **Currently in pre-alpha! Stay tuned for much-needed performance improvements and tons of additional features.**

![Text to Image and Painting](demo-paint.jpg "Title")
## Text-to-Image + Painting
Generate images with text-to-image, powered by Stable Diffusion running on your local PC (or via any network API), using whatever models and custom tooling you want. Adjust generation settings from the app's clean and intuitive interface. **Currently in pre-alpha! Stay tuned for a full suite of settings and API interfaces, plus the ability to easily and quickly make your own.** Slightly more customizable than Comfy, yet more beautiful and intuitive than A1111. Convert the generated image to a paint layer, and paint away.

![Text to Image and Painting](demo-t2i+paint.jpg "Title")
## Image-to-Image from Painted Layers
Generate subsequent images from your painted layers with new prompts. Simply drag-and-drop to hook up layers, type prompts, configure settings, and generate.

![Image to Image from Painted Layer](demo-i2i.jpg "Title")
## ControlNet
Coming very soon! Lineart, upscaling, pose, and much more!

## Installation

### One-Click Install
Coming very soon! A Windows binary and Android APK will be available.

### Requirements
1. NodeJS. You can install it from [https://nodejs.org/en](https://nodejs.org/en).

### Install
1. Clone the repository to a directory on your local device.
2. From the terminal, at the top-level of the repository, run `node server.js`.
    * Note the address `http://{local_ip_address}:6789/` logged in the terminal.
3. On your Android tablet, launch Chrome and navigate to that address. (Only Chrome/Android is supported for now.)
4. Tap the full-screen icon in the top-left to dive into the app and begin. :-)  

**Currently in pre-alpha! Full tuturials and documentation will be coming soon.** The app's layout is standard and hopefully intuitive, and there are tooltips.

## Features: Done & To-Do
- ✅ Multitouch
    - ✅ Pinch to zoom / rotate / pan
    - ❌ Gestures triple-tap+drag
- ✅ Pen Stylus Input
    - ✅ Pressure & Tilt
- ✅ Layers
    - ✅ Paint
    - ✅ AI Generation
    - ✅ Merge
    - ✅ Duplicate
    - ✅ Visibility
    - ✅ Opacity
    - ✅ Masks
    - ❌ Rename
    - ❌ Reorganize
    - ❌ Layer Groups
- ✅ Undo / Redo
- ✅ Save / Load
- ❌ Gallery View
- ✅ Export
- ✅ Paint
    - ✅ Brush tip image
    - ✅ Pressure & tilt dynamics
    - ✅ Size
    - ✅ Opacity
    - ✅ Softness
    - ✅ Colorwheel
    - ✅ Eyedropper
    - ❌ Custom brushes asset browser
    - ✅ Erase
    - ✅ Blend (on solid layers)
    - ❌ Blend (on transparent layers)
    - ❌ GPU Paint
- ✅ AI Generation
    - ✅ Image inputs UI
    - ❌ Generation history
    - ✅ Universal APIFlow System
    - ✅ Builtin APIFlows
        - ✅ A1111 img2img / inpainting-with-mask (demo)
        - ✅ A1111 txt2img (demo)
        - ❌ A1111 controlnet (demo)
        - ❌ A1111 controlnet preprocessor (demo)
        - ❌ A1111 upscale (demo)
        - ❌ Comfy img2img / inpainting-with-mask (demo)
        - ❌ Comfy txt2img (demo)
        - ❌ Comfy controlnet (demo)
        - ❌ Comfy controlnet preprocessor (demo)
        - ❌ Comfy upscale (demo)
    - ❌ Design custom APIFlows in-app
    - ❌ Export / Import / Share APIFlows
- ✅ Layer Masks
    - ✅ Paint
    - ✅ Erase
    - ❌ Blend
- ✅ Sleek and Beautiful UI
- ❌ Layer Transforms
    - ❌ Translate
    - ❌ Scale
    - ❌ Rotate
    - ❌ Mirror
    - ❌ Crop / Uncrop
- ❌ Paint Mirror Symmetry
- ❌ Filters
    - ❌ Basic (Hue,Saturation,Luminance,Contrast...)
    - ❌ Channels
- ❌ Clone / Heal Tool
- ❌ Text
    - ❌ Text layer
    - ❌ Import fonts in asset browser
- ❌ One-click Install
    - ❌ Downloadable APK
    - ❌ Compiled Windows Binaries
- ???