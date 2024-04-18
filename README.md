<p align="center" width="100%">
    <img src="logo.jpg"> 
</p>

# ParrotLUX (Version: 2024.04.18-1-alpha)
A Painting App for Open-Source AI

This app is currently in Alpha version. Expect bugs and missing features. Tuturials and documentation will be added soon.

<p align="center" width="100%">
    <img src="showcase-sketch.gif" width="30%"> <img src="showcase-pose.gif" width="30%"> <img src="showcase-paint.gif" width="30%"> 
</p>

# Cross-Platform
This app has been tested in Chrome on: Android, *Windows 11, and Ubuntu.

<img src="os-support.png">

(*Pen pressure is unavailable on Windows.)

(It may also work on MacOS and iOS. Untested.)

# New Features in Version 2024.04.18-1-alpha

## Stable Diffusion 3 Support

<p align="center" width="100%"><img src="img/2024.04.18-alpha-1.jpg"></p>
<p align="center" width="100%">Via the StabilityAI API. Includes img2img and txt2img. APIKey required. <i>(Install APIKey in settings.)</i></p>

## Tightened User Interface and New Icons

<p align="center" width="100%"><img src="img/2024.04.18-alpha-2.jpg"></p>
<p align="center" width="100%">The user interface now fits on smaller screens without zooming out. Brush select now has an icon. All canvas tools have moved to one place. Erase, blend, and mask now have easy-to-read icons. <i>(Bugs with number sliders, element sizes, and phone-screen-sized overflows to be fixed ASAP.)></i></p>

## Select Multiple Layers

<p align="center" width="100%"><img src="img/2024.04.18-alpha-3.jpg"></p>
<p align="center" width="100%">Use the checkbox in the lower-right. Drag multiple layers to groups, transform multiple layers, paint on multiple layers, and color adjust multiple layers at once. <i>(This feature has tons of known bugs to be fixed ASAP.)</i></p>

# Installation

### Requirements
* NodeJS. You can install it from [https://nodejs.org/en](https://nodejs.org/en).
* A PC running ComfyUI or Automatic1111 stable-diffusion-webui. You can install whichever you prefer from [https://github.com/comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI) or [https://github.com/AUTOMATIC1111/stable-diffusion-webui](https://github.com/AUTOMATIC1111/stable-diffusion-webui).
    * ComfyUI should run on port 8188
    * A1111 should run on port 7860
    * The app will support configuring ports etc. in the future
* The Chrome or Chromium browser, running on Android, Windows, or Linux.
    * MacOS and iOS are untested.

### Install
1. Clone this repository to a directory on your local device.
2. From the terminal, at the top-level of the repository, run `node server.js`.
    * Note the address `http://{local_ip_address}:6789/` logged in the terminal.
3. On your Android tablet, launch Chrome and navigate to that address. (Only Chrome on Android is supported for now.)
4. Tap the full-screen icon in the top-left. :-)  

# Features

- Standard Interface
    - Save, load, and export projects
    - Undo and redo
    - Import images as layers
    - Multitouch pan/zoom/rotate
- Layers
    - Rename
    - Merge, duplicate, delete
    - Set opacity and visibility
    - Organize layer groups
    - Non-destructive masks
    - Multitouch transform
    - Resize generative layers
    - (filters coming in Beta)
    - (number-slider transform in Beta)
- Painting
    - Pressure sensitive brushes
    - Softness
    - Opacity
    - Erase
    - Blend
    - GPU optimized
    - (more default brushes coming in Beta)
    - (user-custom brushes coming in Beta)
- Generation
    - Text-to-Image
    - Image-to-Image
    - ControlNet
    - ControlNet Preprocessors
    - Inpainting
    - A1111 and Comfy
    - SD1.5, SDXL, and StableCascade
    - (user-custom apiflows coming in Beta)
- Flood fill
    - area or color
    - padding border
- Posing
- Color Adjustment
    - Saturation
    - Contrast
    - Brightness
    - Hue
    - Invert
- More features coming in Beta!