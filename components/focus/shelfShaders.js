export { vertexShader } from "../shaders/planeShaders";
import { glassShader } from "./glass";
import { cursorLensShader } from "../ring/cursorLens";

// Adapted from the wheel's glassBend and smooth-min surface (MIT, see LICENSE).
// Bend the sampling coordinates, so photographs remain sharp inside the lip.
export const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform sampler2D uAtlas;
  uniform sampler2D uLookup;
  uniform vec2 uTileGrid;
  uniform vec4 uCard[31];
  uniform vec4 uStyle[31];
  uniform vec4 uPointer;
  uniform vec4 uSurface;
  uniform float uTime;
  uniform float uCorner;
  uniform float uGlass;
  uniform float uReveal;

  #define CONTINUOUS_GLASS
  ${glassShader}
  ${cursorLensShader}
  float box(vec2 p,vec2 b,float r) {
    vec2 q=abs(p)-b+r;
    return min(max(q.x,q.y),0.0)+length(max(q,0.0))-r;
  }
  float fuse(float a,float b,float k) {
    float h=clamp(0.5+0.5*(b-a)/max(k,0.001),0.0,1.0);
    return mix(b,a,h)-k*h*(1.0-h);
  }
  vec3 art(vec2 uv,float cell,vec2 fringe,vec2 halfSize) {
    vec2 grid=vec2(mod(cell,6.0),floor(cell/6.0));
    vec2 f=fringe*vec2(1.0,-1.0)/max(halfSize*2.0,vec2(1.0));
    vec2 center=(grid+clamp(uv,0.004,0.996))/6.0;
    vec3 col=texture2D(uAtlas,center).rgb;
    if(dot(fringe,fringe)>0.000001) {
      col.r=texture2D(uAtlas,(grid+clamp(uv+f,0.004,0.996))/6.0).r;
      col.b=texture2D(uAtlas,(grid+clamp(uv-f,0.004,0.996))/6.0).b;
    }
    return col;
  }
  void main() {
    vec2 ps=(vUv-0.5)*uResolution;
    vec2 p=cursorRefract(ps);
    vec2 unbent=p;
    float bend=bendGlass(p)*uReveal;
    p=mix(unbent,p,uReveal);
    float distance=length(p-uPointer.xy);
    float halo=1.0-smoothstep(0.0,uSurface.z,distance);
    float k=uSurface.x+uSurface.y*uPointer.z*halo*halo;
    vec2 tile=clamp(floor((p/uResolution+0.5)*uTileGrid),vec2(0.0),uTileGrid-1.0);
    float row=(tile.y*uTileGrid.x+tile.x+0.5)/(uTileGrid.x*uTileGrid.y);
    float d=1e5,d0=1e5,d1=1e5;
    vec2 uv0=vec2(0.5),uv1=uv0,half0=vec2(1.0),half1=half0;
    float cell0=0.0,cell1=0.0;
    vec4 ids=vec4(-1.0);
    for(int slot=0;slot<31;slot++) {
      int batch=slot/4,component=slot-batch*4;
      if(component==0) ids=texture2D(uLookup,vec2((float(batch)+0.5)/8.0,row));
      if(ids[component]<0.0) break;
      int i=int(ids[component]);
      vec4 c=uCard[i];
      vec2 q=p-c.xy;
      if(any(greaterThan(abs(q),c.zw+vec2(48.0)))) continue;
      float di=box(q,c.zw,min(uCorner,min(c.z,c.w)));
      d=fuse(d,di,k);
      vec2 uv=q/(2.0*c.zw)+0.5;
      uv.y=1.0-uv.y;
      if(di<d0) {
        d1=d0;uv1=uv0;half1=half0;cell1=cell0;
        d0=di;uv0=uv;half0=c.zw;cell0=uStyle[i].w;
      } else if(di<d1) {
        d1=di;uv1=uv;half1=c.zw;cell1=uStyle[i].w;
      }
    }
    d+=sin(distance*0.05-uTime*7.0)*uSurface.w*uPointer.w*exp(-distance/max(uSurface.z,1.0));
    if(d>2.0 && (uCursor.w<0.001 || length(cursorLocal(ps))>1.6)) discard;
    float aa=clamp(fwidth(d),0.5,1.5);
    float alpha=1.0-smoothstep(-aa,aa,d);
    float near=smoothstep(-max(k,1.0),max(k,1.0),d1-d0);
    float rim=1.0-smoothstep(0.0,7.0,max(-d,0.0));
    vec2 inward0=normalize(uv0-0.5+vec2(0.0001))*rim*uGlass*2.5/max(half0,vec2(1.0));
    vec2 inward1=normalize(uv1-0.5+vec2(0.0001))*rim*uGlass*2.5/max(half1,vec2(1.0));
    vec2 fringe=vec2(bend*uFinish.x,0.0)+cursorFringe(ps);
    vec3 col=mix(art(uv1-inward1,cell1,fringe,half1),art(uv0-inward0,cell0,fringe,half0),near);
    col+=bend*uFinish.y;
    col+=rim*uGlass*0.06;
    gl_FragColor=cursorComposite(ps,vec4(col,alpha),vec3(0.980392));
  }
`;
