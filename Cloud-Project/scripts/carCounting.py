#!/usr/bin/env python3


import argparse
import json
import sys
from typing import Tuple, Dict
import os
import numpy as np
import cv2
from ultralytics import YOLO


def parse_xyxy(s: str) -> Tuple[int, int, int, int]: #definerer tellelinja 
    try:
        x1, y1, x2, y2 = map(int, s.split(","))
        return x1, y1, x2, y2
    except Exception as e:
        raise argparse.ArgumentTypeError("--line må være 'x1,y1,x2,y2'") from e


def point_side_of_line(p, line): #Formel for å sjekke om objektet (bilen) er forran eller bak tellelinja vi fant i forrige metode
    x, y = p
    x1, y1, x2, y2 = line
    return (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)


def main():
    #Hvilke argumenter man trenger.
    ap = argparse.ArgumentParser(description="CarCounting (YOLOv8 + ByteTrack)")
    # Støtt begge alias
    ap.add_argument("--source", help="Videokilde (filsti/URL)")
    ap.add_argument("--input", help="Alias for --source")
    # GJØR LINJA VALGFRI (default settes etter vi har åpnet videoen)
    ap.add_argument("--line", type=parse_xyxy, required=False, default=None, help="x1,y1,x2,y2")
    ap.add_argument("--conf", type=float, default=0.15, help="Konfidens terskel")
    # Støtt --meta (vi skriver metadata hit)
    ap.add_argument("--meta", help="Skriv metadata JSON hit")
    # Støtt --out for kompatibilitet (IGNORERES i løsning output=input)
    ap.add_argument("--out", help="(valgfri) Ignoreres hvis du bruker output=input")
    # Forenklingsvalg fastsatt i kode: model=yolov8n.pt, imgsz=640, device=auto
    ap.add_argument("--frames-dir", help="Mappe der snapshots lagres (jpg)", default=None)
    args = ap.parse_args() #Kan her hente ut de ilike verdiene ved å f.eks skrive args.meta

    if args.input and not args.source:
        args.source = args.input

    if not args.source:
        print(json.dumps({"error": "Mangler --source/--input"}))
        sys.exit(2)

    frames_dir = None #file for pictures
    if args.frames_dir:
        frames_dir = args.frames_dir
        os.makedirs(frames_dir, exist_ok=True)

    model = YOLO("yolov8n.pt")
    cap = cv2.VideoCapture(args.source) #henter videoen som skal analyseres
    if not cap.isOpened():
        print(json.dumps({"error": f"Kunne ikke åpne {args.source}"}))
        sys.exit(2)

        # Hent video-meta
    # fps = cap.get(cv2.CAP_PROP_FPS) or 25.0 - kan trenge senere
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)
    if (args.line is not None):
        line = args.line #henter tellelinja
    else:
        line =(0, h // 2, max(1, w - 1), h // 2)
        
    counts: Dict[str, int] = {"car": 0, "truck": 0, "bus": 0, "motorcycle": 0} #Trenger 4 klasser fordi disse er innebygd"

    # track_id -> forrige side av linja
    last_side: Dict[int, float] = {} #stemmer det at nøkkelen skal være en int, når settes denne verdien?
    seen_once: Dict[int, bool] = {} #disse to lagrer hvilken side av linja objektet var på sist og om det har passert linja eller ikke

    saved_images = []  # NYTT: samle relative filbaner til snapshots
    frame_idx = 0
    snap_idx = 0
    while True:
        ret, frame = cap.read() #ret returnerer false dersom det ikke er flere frames i videoen (den er slutt), frame er selve bildet man ser på i denne runden av løkken?
        if not ret:
            break
        frame_idx += 1 
        
        # Bruk innebygd tracking (ByteTrack) for å få ID per objekt
        results = model.track(source=frame, persist=True, conf=args.conf, imgsz=960, verbose=False) #trackeren husker objekter fra forrige frame
        r = results[0] #henter ut framen, hvorfor lager vi en liste dersom det alltid er en frame i den?

        if r is not None and r.boxes is not None and len(r.boxes) > 0: #r.boxes er rammen rundt objektene i framen
            names = r.names  # Henter ut klassene fra en dictionary, can være car, motorbike, person etc. 
            for object in r.boxes: #henter ut hvert objekt b
                # Spor‑ID (kan være None hvis man har tapt spor)
                tid = None
                if hasattr(object, 'id') and object.id is not None:
                    try:
                        tid = int(object.id.item() if hasattr(object.id, 'item') else object.id) #Henter ut tracker-id, hva er tid - tror det er tracker-id, hvordan fungerer disse metodene?
                    except Exception:
                        tid = None
                if tid is None:
                    continue

                # Klassefilter (kun relevante kjøretøy), oversetter tallene til relevante typer kjøretøy
                cls_idx = int(object.cls.item()) if hasattr(object.cls, 'item') else int(object.cls)
                cls_name = names.get(cls_idx, str(cls_idx))
                if cls_name not in counts:
                    continue

                # Finner senterpunktet for klassen
                xyxy = object.xyxy[0].tolist() if hasattr(object, 'xyxy') else object.xyxy
                x1b, y1b, x2b, y2b = [float(v) for v in xyxy]
                cx = (x1b + x2b) / 2.0
                cy = (y1b + y2b) / 2.0
                #bruker senterpunktet til å finne ut hvilken side av tellelinjen den er på 
                side_now = np.sign(point_side_of_line((cx, cy), line)) #Bruker her funksjonen vi hadde lengre oppe i filen, The sign function returns -1 if x < 0, 0 if x==0, 1 if x > 0
                side_prev = last_side.get(tid)
                if side_prev is None:
                    last_side[tid] = side_now #kan ikke telle den med når vi ikke vet hvilken side den var på sist
                    continue

                # Registrer kryssing (fortegnskifte)
                crossed = (side_now != 0 and side_prev != 0 and np.sign(side_now) != np.sign(side_prev))
                if crossed and not seen_once.get(tid, False):
                    counts[cls_name] += 1
                    seen_once[tid] = True  # seen_once trengs for å ikke telle flere ganger

                    if frames_dir: # saving pictures every time we count one extra vehicle
                        snap = frame.copy()
                        # box
                        cv2.rectangle(snap, (int(x1b), int(y1b)), (int(x2b), int(y2b)), (50, 255, 0), 15)
                        # lagre relativ bane i metadata
                        snap_idx +=1
                        fname = f"frame_{frame_idx:06d}.jpg"
                        fpath = os.path.join(frames_dir, fname)
                        cv2.imwrite(fpath, snap)
                        ok = cv2.imwrite(fpath, snap) # writing to file
                        if ok: # this part i chatGPT
                            saved_images.append(os.path.join(frames_dir, fname))

                last_side[tid] = side_now
    
    cap.release() #slipper alle ressurser

    # skriver ett JSON objekt til stdout slik at controller(node) kan lagre resultatet i databasen og returnere til API klient
    #Her må jeg legge til noe dersom jeg skal ha outputvideo også 
    total = int(sum(counts.values()))
    meta_obj = {
    "count": total,
    "by_class": {k: int(v) for k, v in counts.items()},
    "output_video": args.source,
    "images": saved_images  #Pictures as meta-object
    }
    #this code was recomended by chatGPT
    if args.meta:
        try:
            with open(args.meta, "w", encoding="utf-8") as f:
                json.dump(meta_obj, f, ensure_ascii=False)
        except Exception:
            pass
    print(json.dumps(meta_obj))    
if __name__ == "__main__":
    main()
