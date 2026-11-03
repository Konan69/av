# Measure a recording against its own audio: pace (frame change, cuts), beat lock, A/V correlation,
# lit area, hue spread, mirror symmetry.
# usage: uv run --with librosa --with opencv-python-headless python3 scripts/measure-recording.py NAME VIDEO [roi-json]
import cv2, numpy as np, librosa, subprocess, json, sys, os
def audio(path):
    wav='/tmp/_a.wav'; subprocess.run(['ffmpeg','-v','error','-y','-i',path,'-ac','1','-ar','22050',wav],check=True)
    y,sr=librosa.load(wav,sr=22050); tempo,beats=librosa.beat.beat_track(y=y,sr=sr,units='time')
    on=librosa.onset.onset_detect(y=y,sr=sr,units='time')
    return float(np.atleast_1d(tempo)[0]),beats,on
def video(path,roi=None):
    cap=cv2.VideoCapture(path); fps=cap.get(cv2.CAP_PROP_FPS); prev=None; out=[]
    i=0
    while True:
        ok,f=cap.read()
        if not ok: break
        if roi: f=f[roi[1]:roi[3],roi[0]:roi[2]]
        f=cv2.resize(f,(270,int(270*f.shape[0]/f.shape[1])))
        hsv=cv2.cvtColor(f,cv2.COLOR_BGR2HSV); v=hsv[...,2].astype(float)/255; s=hsv[...,1].astype(float)/255
        lit=(v>0.35)
        cov=lit.mean()
        hue=float(np.median(hsv[...,0][lit&(s>0.3)])*2) if (lit&(s>0.3)).sum()>30 else -1
        scov=(lit&(s>0.35)).mean()
        sat=float(s[lit].mean()) if lit.sum()>0 else 0
        g=cv2.cvtColor(f,cv2.COLOR_BGR2GRAY).astype(float)/255
        diff=float(np.abs(g-prev).mean()) if prev is not None else 0
        prev=g
        # symmetry: mirror LR correlation of lit mask around its centroid col
        ys,xs=np.nonzero(lit)
        sym=-1
        if len(xs)>50:
            cx=int(xs.mean()); w=min(cx,g.shape[1]-cx)
            if w>10:
                L=g[:,cx-w:cx]; R=g[:,cx:cx+w][:,::-1]; sym=float(np.corrcoef(L.ravel(),R.ravel())[0,1])
        out.append(dict(t=i/fps,cov=cov,scov=scov,hue=hue,sat=sat,diff=diff,sym=sym)); i+=1
    return fps,out
name,path=sys.argv[1],sys.argv[2]
roi=json.loads(sys.argv[3]) if len(sys.argv)>3 else None
tempo,beats,on=audio(path); fps,fr=video(path,roi)
y,sr=librosa.load('/tmp/_a.wav',sr=22050); hop=int(round(sr/fps)); env=librosa.onset.onset_strength(y=y,sr=sr,hop_length=hop)
dd=np.array([x['diff'] for x in fr]); n=min(len(env),len(dd)); e=(env[:n]-env[:n].mean())/(env[:n].std()+1e-9); v=(dd[:n]-dd[:n].mean())/(dd[:n].std()+1e-9)
xc={k:float(np.mean(e[max(0,-k):n-max(0,k)]*v[max(0,k):n-max(0,-k)])) for k in range(-6,7)}
bestlag=max(xc,key=xc.get)
bf=[int(b*fps) for b in beats if int(b*fps)<len(dd)]
onb=float(np.mean([dd[max(0,i-1):i+2].max() for i in bf])) if bf else 0

d=np.array([x['diff'] for x in fr]); t=np.array([x['t'] for x in fr])
thr=np.percentile(d,92); peaks=[t[i] for i in range(1,len(d)-1) if d[i]>thr and d[i]>=d[i-1] and d[i]>=d[i+1]]
def near(ts,ref,tol):
    return float(np.mean([np.min(np.abs(np.array(ref)-x))<tol for x in ts])) if len(ts) and len(ref) else 0
beat_int=60/tempo if tempo>0 else 0.5
rng=np.random.default_rng(0); rand=rng.uniform(t.min(),t.max(),500)
cov=np.array([x['cov'] for x in fr]); hues=[x['hue'] for x in fr if x['hue']>=0]; sym=[x['sym'] for x in fr if x['sym']>-1]
print(json.dumps(dict(name=name,audio_visual_xcorr=round(xc[bestlag],2),lag_frames=bestlag,diff_on_beat_vs_mean=round(onb/(dd.mean()+1e-9),2),tempo=round(tempo,1),n_visual_changes=len(peaks),changes_per_sec=round(len(peaks)/t.max(),2),beats_per_sec=round(1/beat_int,2),
 change_on_beat=round(near(peaks,beats,0.07),2),random_on_beat=round(near(rand,beats,0.07),2),
 lit_cov_median=round(float(np.median(cov))*100,1),sat_lit_cov_median=round(float(np.median([x['scov'] for x in fr]))*100,1),lit_cov_p90=round(float(np.percentile(cov,90))*100,1),
 hue_median=round(float(np.median(hues)),0) if hues else None,hue_iqr=round(float(np.subtract(*np.percentile(hues,[75,25]))),0) if hues else None,
 sat_lit=round(float(np.mean([x['sat'] for x in fr])),2),mean_frame_change=round(float(d.mean())*100,2),cuts_per_sec=round(float((d>0.06).sum())/t.max(),2),mirror_corr_median=round(float(np.median(sym)),2) if sym else None)))
