'use client';

import { useEffect, useRef } from 'react';

export default function SnowEffect({ opacity = 0.9 }: { opacity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl') as WebGLRenderingContext;
    if (!gl) return;

    const vsSource = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision highp float;
      uniform vec2 iResolution;
      uniform float iTime;
      uniform sampler2D iChannel0;

      #define LAYERS 50
      #define DEPTH .5
      #define WIDTH .3
      #define SPEED .6

      void main() {
        mat3 p = mat3(13.323122,23.5112,21.71123,21.1212,28.7312,11.9312,21.8112,14.7212,61.3934);
        vec2 uv = vec2(1.,iResolution.y/iResolution.x)*gl_FragCoord.xy / iResolution.xy;

        // 背景纹理 cover 模式
        float imgRatio = 4.0 / 3.0;
        float screenRatio = iResolution.x / iResolution.y;
        vec2 bgUV = vec2(gl_FragCoord.x / iResolution.x, 1.0 - gl_FragCoord.y / iResolution.y);
        if (screenRatio > imgRatio) {
          float scale = screenRatio / imgRatio;
          bgUV.y = bgUV.y / scale;
        } else {
          float scale = imgRatio / screenRatio;
          bgUV.x = (bgUV.x - 0.5) / scale + 0.5;
        }
        vec3 col = texture2D(iChannel0, bgUV).rgb * 0.75;

        vec3 acc = vec3(0.0);
        float dof = 5.*sin(iTime*.1);
        for (int i=0;i<LAYERS;i++) {
          float fi = float(i);
          vec2 q = uv*(1.+fi*DEPTH);
          q += vec2(q.y*(WIDTH*mod(fi*7.238917,1.)-WIDTH*.5),SPEED*iTime/(1.+fi*DEPTH*.03));
          vec3 n = vec3(floor(q),31.189+fi);
          vec3 m = floor(n)*.00001 + fract(n);
          vec3 mp = (31415.9+m)/fract(p*m);
          vec3 r = fract(mp);
          vec2 s = abs(mod(q,1.)-.5+.9*r.xy-.45);
          s += .01*abs(2.*fract(10.*q.yx)-1.);
          float d = .6*max(s.x-s.y,s.x+s.y)+max(s.x,s.y)-.01;
          float edge = .005+.05*min(.5*abs(fi-5.-dof),1.);
          acc += vec3(smoothstep(edge,-edge,d)*(r.x/(1.+.02*fi*DEPTH)));
        }

        col += acc * 0.9;
        col = clamp(col, 0.0, 1.0);

        float fade = smoothstep(0., 3., iTime);
        gl_FragColor = vec4(col * fade, 1.0);
      }
    `;

    function compileShader(type: number, source: string) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1,
    ]), gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, 'a_position');
    const resolutionLoc = gl.getUniformLocation(program, 'iResolution');
    const timeLoc = gl.getUniformLocation(program, 'iTime');
    const channel0Loc = gl.getUniformLocation(program, 'iChannel0');

    const texture = gl.createTexture();
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    };
    img.src = '/snow-bg.jpg';

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
    }
    resize();
    window.addEventListener('resize', resize);

    let animId: number;
    const startTime = performance.now();

    function render() {
      const t = (performance.now() - startTime) / 1000;
      gl!.useProgram(program);
      gl!.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl!.enableVertexAttribArray(positionLoc);
      gl!.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
      gl!.uniform2f(resolutionLoc, canvas!.width, canvas!.height);
      gl!.uniform1f(timeLoc, t);
      gl!.activeTexture(gl.TEXTURE0);
      gl!.bindTexture(gl.TEXTURE_2D, texture);
      gl!.uniform1i(channel0Loc, 0);
      gl!.drawArrays(gl.TRIANGLES, 0, 6);
      animId = requestAnimationFrame(render);
    }
    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      gl!.deleteProgram(program);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        opacity,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
