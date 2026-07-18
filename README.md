# SPWM Filter Designer

A web tool for calculating low-pass filter values for STM32 sinusoidal PWM outputs.

<!-- ![Screenshot](screenshot.png)-->

## What it does

When you generate a sine wave using SPWM on an STM32, you need to filter the PWM signal to recover the analog sine wave. This tool calculates the right resistor, capacitor, and inductor values for:

- **RC filters** – simple, cheap, good for testing
- **LC filters** – efficient, good for power inverters
- **RLC filters** – damped LC, good for audio

## How to use

1. Enter your PWM frequency (the carrier)
2. Enter your desired sine frequency
3. Select filter type
4. Click Calculate

The tool shows you:
- Component values (R, C, L)
- Connection diagram
- Frequency response plot
- Comparison between filter types

## Live version

[https://alireza-jahanbakhshi.github.io/SPWM_Filter_Designer/](https://alireza-jahanbakhshi.github.io/SPWM_Filter_Designer/)
## Built with

- Plain HTML + CSS + JavaScript
- Chart.js for the frequency response plot
- No frameworks, no build tools

## Author

**Alireza Jahanbakhshi**

- GitHub: [@Alireza-Jahanbakhshi](https://github.com/Alireza-Jahanbakhshi)

## License

MIT
