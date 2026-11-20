# ElectricSound

Prototyping synthetic engine sound for electric vehicles, from motor whine to acceleration feedback

## What it is

ElectricSound uses GPS tracking to measure how fast you're going and how hard you're accelerating, calculates the throttle you'd be giving a real engine, and pairs it with a live engine sound that revs, shifts and crackles as you drive.

- **Accurate speed tracking**: reads your speed straight from GPS and smooths it between updates, so the engine stays in step with your speedometer.
- **17+ cars to pick from**, including the Porsche 911 GT3, Lamborghini Huracán, Ferrari 812 Superfast and Bugatti Chiron, each with its engine and exhaust specs.
- **Test drive mode**: try any car with on-screen gas and brake pedals, no GPS needed.

## Purpose

ElectricSound is meant as a fun way to enjoy EVs. Electric cars are quick, smooth and quiet; this adds the soundtrack. Pick a flat-six, a V10 or a V12 and hear it sing every time you pull away from a light.

## First Issue
1. GPS updates once a second, therefore the site predicts speed in between. When acceleration stops, the predicition keeps climbing. Known as the Overshoot.
2. **Tested** on 60 drives (30 real + 30 simulated)
  - hard 4.5s
  - brisk 9s
3.  | Value | Lag while accelerating | Overshoot hard+quick lift | Overshoot hard + normal lift | Overshoot brisk + normal lift | Wobble |
    | --- | --- | --- | --- | --- | --- |
    | 1.2 | 0.08s | 8.3mph | 5.1 mph | 2.5 mph | none (±0.4mph) |
    | 0.8 | 0.10s | 7.3mph | 4.3mph | 2.1 mph | none (±0.5mph) |
    | 0.6 | 0.16s | 5.3 | 2.9 mph | 1.4 mph | yes (±1mph) |
4. **Legend**
  - Lag: How far behind your real speed the sounds run wile accelerating
  - Overshoot: Speed at which the sounds goes to a second after acceleration stops. GPS predicts its increasing
  - Wobble: Amount at which the speed jitters during hard acceleration. ±0.4 mph is normal GPS and can't be heard. ±1mph means the speed pauses and jumps every second, which is why the driver would hear revs pulsing.
  - Value: Amount of seconds the browsers guesses location in between GPS updates
## Results
The 3 values were tested 1.2, 0.8, 0.6 to see how far the overshoot would cut.

0.8s Cuts the overshoot by 12-16%, and causes no wobble. 



