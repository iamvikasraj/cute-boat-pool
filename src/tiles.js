// Soft mosaic for the pool's inside, drawn in the shader from world position (the Blender
// export has no UVs). Square tiles with grooved grout, a little shade variation per tile,
// and a darker band along the waterline.
export function applyPoolTiles(material, {
  size = 0.25,          // tile edge, metres
  grout = 0.05,         // grout width as a fraction of a tile
  bandFrom = -0.2,      // walls above this height get the waterline band
  bandColor = [0.05, 0.3, 0.52], // linear RGB
  groutLift = 0.55,     // how far grout is mixed toward white
  bump = 0.012,
} = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tileSize: { value: size },
      tileGrout: { value: grout },
      tileBandFrom: { value: bandFrom },
      tileBandColor: { value: bandColor },
      tileGroutLift: { value: groutLift },
      tileBump: { value: bump },
    });

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTileWorld;
        varying vec3 vTileNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTileWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTileNormal = normalize(mat3(modelMatrix) * objectNormal);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTileWorld;
        varying vec3 vTileNormal;
        uniform float tileSize, tileGrout, tileBandFrom, tileGroutLift, tileBump;
        uniform vec3 tileBandColor;

        float tileHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

        // x: 1 on a tile face, 0 in the grout. y: per-tile random. z: 1 if in the waterline band.
        vec3 tileSample() {
          vec3 n = abs(vTileNormal);
          bool wall = n.y < 0.5;
          // pick the projection facing the surface; walls run rows up from the band line
          vec2 uv = !wall ? vTileWorld.xz : (n.x > n.z ? vTileWorld.zy : vTileWorld.xy);
          if (wall) uv.y -= tileBandFrom;
          vec2 g = uv / tileSize;
          vec2 cell = floor(g), f = fract(g);
          float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
          float aa = fwidth(edge) * 1.5;
          float face = smoothstep(tileGrout * 0.5, tileGrout * 0.5 + max(aa, 0.04), edge);
          float band = wall && cell.y >= 0.0 ? 1.0 : 0.0;
          return vec3(face, tileHash(cell + (wall ? 17.0 : 0.0)), band);
        }

        vec3 tilePerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
          vec3 sx = normalize(dFdx(surfPos)), sy = normalize(dFdy(surfPos));
          vec3 r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
          float det = dot(sx, r1) * faceDir;
          vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
          return normalize(abs(det) * surfNorm - grad);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 tileInfo = tileSample();
        vec3 tileBase = mix(diffuseColor.rgb, tileBandColor, tileInfo.z);
        // each tile a touch lighter/darker and bluer/greener, like hand-laid mosaic
        float tv = tileInfo.y - 0.5;
        tileBase *= 1.0 + tv * 0.16;
        tileBase.g *= 1.0 + tv * 0.06;
        vec3 groutCol = mix(diffuseColor.rgb, vec3(1.0), tileGroutLift);
        diffuseColor.rgb = mix(groutCol, tileBase, tileInfo.x);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.85, roughnessFactor, tileInfo.x);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 tileDh = vec2(dFdx(tileInfo.x), dFdy(tileInfo.x)) * tileBump / max(tileSize, 1e-4);
        normal = tilePerturb(-vViewPosition, normal, tileDh, faceDirection);`);
  };
  material.customProgramCacheKey = () => 'pool-tiles';
  material.needsUpdate = true;
}
