# Little boat, big pool

A three.js scene built from the Blender file. Drive the boat, bump the floaties, splash the water.

## Run

    npm install
    npm run dev

## Controls

- W A S D or arrow keys: steer
- Space: hop
- Click the water: splash
- Click the ball, donut or boat: poke it
- Drag: orbit the camera (it follows the boat)
- On phones: stick bottom left, hop button bottom right

## Files

- `public/models/pool-scene.glb` exported from Blender (Visible Objects, Apply Modifiers, +Y up)
- `src/water.js` ripple sim on a grid shaped like the pool
- `src/physics.js` floaters: circle collisions, pool walls, bobbing and tilting on the ripples
- `src/main.js` scene, boat driving, blinking eyes, flag, chimney puffs
- `src/input.js` keyboard and touch stick

## Re-exporting from Blender

Keep these object names, the code looks them up:
CuteBoat, BeachBall, DonutFloatie, PoolWater, Pennant, Eye_L, Eye_R, EyeGlint_L, EyeGlint_R.

Adding another floatie: export it, then add a `new Floater(obj, { radius, mass })` in main.js and push it into `floaters`.
