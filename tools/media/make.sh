#!/bin/sh
# Rebuilds the test media in public/media/. Needs ffmpeg and node.
# clip.webm: 10 s, 640x360, 30 fps, VP9 + Opus. The top right corner holds the
#   frame number as 16 black or white stripes, 20 px wide, lowest bit first, so
#   a page can read which frame a canvas shows.
# alpha.webm: VP9 with an alpha channel.
# protected.webm: 4 s of clip.webm, Clear Key encrypted (key in encrypt-webm.mjs).
set -e
cd "$(dirname "$0")/../../public/media"
BAR="geq=lum='if(lt(Y,16)*gte(X,W/2),if(mod(floor(N/pow(2,floor((X-W/2)/20))),2),235,16),lum(X,Y))':cb='if(lt(Y,16)*gte(X,W/2),128,cb(X,Y))':cr='if(lt(Y,16)*gte(X,W/2),128,cr(X,Y))'"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "mandelbrot=size=640x360:rate=30:start_scale=2.2:end_scale=0.02:end_pts=300,format=yuv420p,$BAR" \
  -f lavfi -i "aevalsrc='0.35*sin(2*PI*(220+110*floor(mod(t*2,4)))*t)*exp(-6*mod(t,0.5))+0.25*sin(2*PI*55*t)*exp(-10*mod(t,1))+0.12*sin(2*PI*(880+440*sin(2*PI*0.2*t))*t)*(0.5+0.5*sin(2*PI*4*t))':s=48000:c=stereo" \
  -t 10 -c:v libvpx-vp9 -b:v 400k -g 30 -row-mt 1 -cpu-used 3 -c:a libopus -b:a 48k clip.webm
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "color=c=black:size=240x240:rate=30,format=yuva420p,geq=lum='128+100*sin(hypot(X-120-60*cos(T*2),Y-120-60*sin(T*2))/6)':cb='128+90*cos(T*2)':cr='128+90*sin(T*2)':a='if(lt(hypot(X-120-60*cos(T*2),Y-120-60*sin(T*2)),56),255,0)'" \
  -t 3.1416 -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 120k alpha.webm
ffmpeg -hide_banner -loglevel error -y -i clip.webm -t 4 -an -vf scale=320:180 -c:v libvpx-vp9 -b:v 150k -g 30 -keyint_min 30 -auto-alt-ref 0 -f ivf /tmp/protected.ivf
node ../../tools/media/encrypt-webm.mjs /tmp/protected.ivf protected.webm
rm -f /tmp/protected.ivf protected.mp4
