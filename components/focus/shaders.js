export { vertexShader } from "../shaders/planeShaders";
import { glassShader } from "./glass";

// The ring's rounded SDF union, edge-colour mixing and tapered bridge model,
// with per-card dimensions so portraits keep their original framing.
export const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform sampler2D uAtlas;
  uniform sampler2D uLookup;
  uniform vec2 uTileGrid;
  uniform float uGrid;
  uniform vec4 uCard[31];
  uniform vec4 uStyle[31];
  uniform vec2 uPull[31];
  uniform float uCount;
  uniform vec4 uEnds[8];
  uniform vec4 uThread[8];
  uniform float uLinks;
  uniform float uGoo;
  uniform float uGlass;
  uniform vec4 uCue;
  uniform vec3 uCueStyle;
  uniform vec4 uReadyRipple;
  uniform vec3 uReadyRippleFx;
  ${glassShader}

  float box(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }
  float fuse(float a, float b, float k) {
    float h = max(k - abs(a-b), 0.0) / max(k, 0.001);
    return min(a,b) - h*h*k*0.25;
  }
  float bridge(vec2 p, vec4 ends, vec4 shape) {
    vec2 ba = ends.zw - ends.xy;
    float len = max(length(ba), 0.001);
    vec2 dir = ba/len;
    vec2 normal = vec2(-dir.y, dir.x);
    vec2 q = p - (ends.xy+ends.zw)*0.5;
    float along = dot(q,dir);
    float h = clamp(along/len+0.5,0.0,1.0);
    float bell = sin(3.14159265*h);
    float radius = mix(shape.y, shape.x, pow(1.0-bell,1.7));
    return max(abs(along)-len*0.5, abs(dot(q,normal)+shape.z*bell*normal.y)-radius);
  }
  vec3 art(vec2 uv, float cell) {
    uv = clamp(uv,vec2(0.006),vec2(0.994));
    return texture2D(uAtlas,(vec2(mod(cell,uGrid),floor(cell/uGrid))+uv)/uGrid).rgb;
  }
  void main() {
    vec2 p = (vUv - 0.5)*uResolution;
    vec2 cuePoint=p-uCue.xy;
    float cueDistance=length(cuePoint)-uCue.z;
    float cueGoo=min(2.0,uCueStyle.x);
    cueDistance=fuse(cueDistance,length(cuePoint-vec2(uCueStyle.x,0.0))-uCue.z,cueGoo);
    cueDistance=fuse(cueDistance,length(cuePoint+vec2(uCueStyle.x,0.0))-uCue.z,cueGoo);
    float cueAlpha=(1.0-smoothstep(-0.7,0.7,cueDistance))*uCue.w;
    cueAlpha*=mix(1.0,uCueStyle.z,uCueStyle.y);
    float bend=bendGlass(p);
    float d=1e5;
    vec3 col=vec3(1.0);
    vec2 normal0=vec2(0.0);
    vec2 tile=clamp(floor((p/uResolution+0.5)*uTileGrid),vec2(0.0),uTileGrid-1.0);
    float row=(tile.y*uTileGrid.x+tile.x+0.5)/(uTileGrid.x*uTileGrid.y);
    vec4 ids=vec4(-1.0);
    for(int slot=0;slot<31;slot++) {
      int batch=slot/4;
      int component=slot-batch*4;
      if(component==0)
        ids=texture2D(uLookup,vec2((float(batch)+0.5)/8.0,row));
      float id=ids[component];
      if(id<0.0) break;
      int i=int(id);
      vec4 card=uCard[i], style=uStyle[i];
      if(card.z<0.1 || card.w<0.1) continue;
      vec2 q=p-card.xy;
      if(any(greaterThan(abs(q), card.zw + vec2(38.0)))) continue;
      float c=cos(style.y), s=sin(style.y);
      q=vec2(q.x*c+q.y*s,-q.x*s+q.y*c);
      vec2 touch=uPull[i]*card.zw;
      vec2 delta=(q-touch)/max(card.zw,vec2(1.0));
      q-=uPull[i]*exp(-dot(delta,delta)*3.5)*style.z*7.0;
      float di=box(q,card.zw,min(style.x,min(card.z,card.w)));
      if(di>30.0) continue;
      vec2 uv=q/(card.zw*2.0)+0.5;
      uv.y=1.0-uv.y;
      // A rounded glass rim bends the photograph itself, not a coloured line.
      vec2 n=normalize(q/max(card.zw,vec2(1.0))+vec2(0.0001));
      float lip=exp(-abs(di)/6.0)*uGlass;
      uv+=(uv-0.5)*lip*0.075;
      float rippleLight=0.0;
      if(i==0 && uReadyRipple.y>0.001) {
        float radius=length(q);
        float wavelength=max(uReadyRipple.z,1.0);
        float travel=uReadyRipple.x*uReadyRipple.w;
        float width=max(uReadyRippleFx.z,0.01);
        // Keep both sides of the first crest inside its travelling envelope.
        float front=1.0-smoothstep(travel+wavelength*width*2.0,
          travel+wavelength*width*4.0,radius);
        float envelope=front*smoothstep(0.0,wavelength*0.12,radius)
          *exp(-radius/(wavelength*3.5))
          *smoothstep(0.0,wavelength*0.22,-di)*uReadyRipple.y;
        float crest=(fract((radius-travel)/wavelength+0.5)-0.5)
          /width;
        float band=exp(-0.5*crest*crest);
        float wave=crest*band;
        vec2 radial=q/max(radius,0.001);
        // Displace the photograph only; the card's silhouette stays still.
        uv+=radial*vec2(1.0,-1.0)*wave*envelope*uReadyRippleFx.x/(card.zw*2.0);
        rippleLight=(1.0-crest*crest)*band*envelope*uReadyRippleFx.y;
      }
      float blend=clamp(0.5+0.5*(d-di)/max(uGoo,0.001),0.0,1.0);
      col=mix(col,art(uv,style.w)+rippleLight,blend);
      normal0=mix(normal0,n,blend);
      d=fuse(d,di,uGoo);
    }
    for(int i=0;i<8;i++) {
      if(float(i)>=uLinks) break;
      vec4 ends=uEnds[i], shape=uThread[i];
      if(any(lessThan(p,min(ends.xy,ends.zw)-vec2(40.0))) ||
         any(greaterThan(p,max(ends.xy,ends.zw)+vec2(40.0)))) continue;
      float neck=bridge(p,ends,vec4(shape.xy,0.0,shape.w));
      if(neck<d) {
        float t=clamp(dot(p-ends.xy,ends.zw-ends.xy)/max(dot(ends.zw-ends.xy,ends.zw-ends.xy),1.0),0.0,1.0);
        vec3 colour=mix(art(vec2(0.5),0.0),art(vec2(0.5),shape.z),smoothstep(0.2,0.8,t));
        col=mix(col,colour,clamp((d-neck)/max(shape.w,1.0),0.0,1.0));
      }
      d=fuse(d,neck,shape.w);
    }
    if(d>20.0 && cueAlpha<0.001) discard;
    float aa=clamp(fwidth(d),0.65,1.5);
    float alpha=1.0-smoothstep(-aa,aa,d);
    float shadow=exp(-max(d,0.0)/5.5)*0.055;
    float rim=exp(-abs(d)/2.8)*uGlass;
    float shine=clamp(dot(normal0,normalize(vec2(-0.5,0.9))),0.0,1.0);
    col=mix(col,vec3(1.0),rim*(0.18+shine*0.42));
    col*=1.0-exp(-abs(d+5.0)/3.0)*uGlass*0.12;
    col+=bend*uFinish.y;
    vec3 sceneColour=mix(vec3(0.25),col,alpha);
    float sceneAlpha=max(alpha,shadow);
    vec3 cueColour=vec3(mix(0.447,1.0,uCueStyle.y));
    float finalAlpha=cueAlpha+sceneAlpha*(1.0-cueAlpha);
    vec3 finalColour=(cueColour*cueAlpha+sceneColour*sceneAlpha*(1.0-cueAlpha))
      /max(finalAlpha,0.001);
    gl_FragColor=vec4(finalColour,finalAlpha);
  }
`;
