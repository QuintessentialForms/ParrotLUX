<p align="center" width="100%">
    <img src="logo.jpg"> 
</p>

# ParrotLUX (V0.1-Alpha)
A Painting App for Open-Source AI

**This app is currently in Alpha version. Expect bugs and missing features. Tuturials and documentation will be added soon.**

<p align="center" width="100%">
    <img src="showcase-sketch.gif" width="30%"> <img src="showcase-pose.gif" width="30%"> <img src="showcase-paint.gif" width="30%"> 
</p>

# Installation

### Requirements
* NodeJS. You can install it from [https://nodejs.org/en](https://nodejs.org/en).
* A PC running ComfyUI or Automatic1111 stable-diffusion-webui. You can install whichever you prefer from [https://github.com/comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI) or [https://github.com/AUTOMATIC1111/stable-diffusion-webui](https://github.com/AUTOMATIC1111/stable-diffusion-webui).
    * ComfyUI should run on port 8188
    * A1111 should run on port 7860
    * The app will support configuring ports etc. in the future
* An Android tablet with a pen stylus input (for example, a Samsung Galaxy Tab), with Chrome installed.
    * iPad may be supported in the future, and may already work. Untested.

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