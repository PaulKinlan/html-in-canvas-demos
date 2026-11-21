#!/bin/sh
# Builds public/cassette/tape.webm: 24 s of generated music (Opus in WebM, stereo) for the cassette deck page.
#
#   sh tools/cassette/make.sh
#
# Needs ffmpeg. The sound is three sine voices written as an aevalsrc expression:
# a bass note every beat, an arpeggio of four notes per beat and a slow lead.
set -e
cd "$(dirname "$0")/../../public/cassette"
BEAT=0.5
BASS="0.30*sin(2*PI*(55*pow(2,(floor(mod(t/2,4))*(floor(mod(t/2,4))-1)*-1.5+floor(mod(t/2,4))*3.5)/12))*t)*exp(-5*mod(t,$BEAT))"
ARP="0.16*sin(2*PI*(220*pow(2,(floor(mod(t*8,4))*4-floor(mod(t*8,4))*floor(mod(t*8,4))*0.5+floor(mod(t/2,4))*2)/12))*t)*exp(-14*mod(t,0.125))"
LEAD="0.10*sin(2*PI*(440*pow(2,(floor(mod(t,8))*2-floor(mod(t,8))*floor(mod(t,8))*0.25)/12))*t+1.5*sin(2*PI*5*t))*(0.5+0.5*sin(2*PI*t/8))"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "aevalsrc='$BASS+$ARP+0.6*($LEAD)|$BASS+0.6*($ARP)+$LEAD':s=48000" \
  -t 24 -af "afade=t=in:d=0.05,afade=t=out:st=23:d=1" -c:a libopus -b:a 56k tape.webm
ls -la tape.webm
