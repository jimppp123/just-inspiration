// Shared perimeter refraction for the shelf and explorer. The image bends
// inside the edge; there is no stroked border to produce a white seam.
export const glassShader = /* glsl */ `
  uniform vec4 uBands;
  uniform vec4 uLip;
  uniform vec2 uFinish;
  uniform float uContentTop;
  float profile(float distance, float band) {
    float t=clamp(1.0-distance/max(band,0.01),0.0,1.0);
    #ifdef CONTINUOUS_GLASS
    return t*t;
    #else
    return 1.0-sqrt(max(0.0,1.0-t*t));
    #endif
  }
  float bendGlass(inout vec2 p) {
    float topY=uResolution.y*0.5-uContentTop;
    float top=profile(topY-p.y,uBands.x)*step(p.y,topY);
    float bottom=profile(p.y+uResolution.y*0.5,uBands.z);
    float side=p.x>0.0?uBands.y:uBands.w;
    float bx=profile(uResolution.x*0.5-abs(p.x),side);
    float vertical=uLip.x+sin(p.x*uLip.w)*uLip.z;
    #ifdef CONTINUOUS_GLASS
    // The quadratic profile has slope <= 2/band. Keep UVs moving forward.
    p.y-=top*clamp(vertical,-uBands.x*0.4,uBands.x*0.4);
    p.y+=bottom*clamp(vertical,-uBands.z*0.4,uBands.z*0.4);
    #else
    p.y-=top*vertical;
    p.y+=bottom*vertical;
    #endif
    float horizontal=min(uLip.x,side*0.3)+sin(p.y*uLip.w)*uLip.z*0.3;
    #ifdef CONTINUOUS_GLASS
    horizontal=clamp(horizontal,-side*0.4,side*0.4);
    #endif
    p.x-=sign(p.x)*bx*horizontal;
    p*=vec2(1.0-max(top,bottom)*uLip.y,1.0-bx*uLip.y);
    return max(bx,max(top,bottom));
  }
`;
