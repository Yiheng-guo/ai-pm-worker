"""Narrated operating tutorial from genuine CUA screenshots. Not a continuous recording.
Run with bundled Python (Pillow + imageio_ffmpeg) on macOS; speech uses system Tingting.
"""
from pathlib import Path
import json, math, re, subprocess, wave
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

root=Path(__file__).resolve().parents[3]
folder=root/'docs/tutorial'
work=root/'.cache/tutorial';work.mkdir(parents=True,exist_ok=True)
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
fontfile='/System/Library/Fonts/STHeiti Medium.ttc'
def font(size): return ImageFont.truetype(fontfile,size)
shots=[
 ('01-home','从这里开始','公开链接学操作，本机版本执行真实任务。','这是亦伴零点六版。先用公开演示熟悉操作，再在本机版本委托真实任务。视频由实际操作截图剪辑，省略了等待过程。'),
 ('02-goal-input','01 / 写下长期目标','右侧「我的长期目标」→ 输入方向 → 点加号。','第一步，在右侧我的长期目标中，写下你要持续推进的方向，然后点击加号。例如每周完成一个有证据、有复盘的产品作品。'),
 ('03-goal-saved','02 / 确认目标已保存','目标会用于后续委托；勾选表示完成。','目标出现在列表里，就说明已保存。本机版本会将未完成目标的摘要带入后续委托。完成后可以勾选，也可以重新打开。'),
 ('04-compose','03 / 写清委托并提交','选择「研究与规划」或「回顾项目与记忆」。','接着写清要做什么，以及怎样验收。这里请它安排三个研究任务，并给出验收依据。选择研究与规划，或者回顾项目与记忆，再点击交给亦伴。'),
 ('05-inbox','04 / 到收件箱看进展','公开页返回固定说明；真实任务需要等待执行。','任务完成后，到结果收件箱查看。注意，这里是公开示例，返回固定说明，没有调用模型。真实版本会排队执行，并保留成功、失败和取消记录。'),
 ('06-detail','05 / 检查交付，再标记已读','「结果、证据与取消入口」可以打开详情。','点击结果、证据与取消入口。本机版会进入运行详情，再继续查看证据、需求与原型。公开页只展示流程说明。检查之后标记已读，记录仍保留在持续对话里。'),
 ('07-routine-form','06 / 设置有限次数跟进','每周 = 168 小时；这里最多执行 3 次。','要定期复盘，就打开设置有限次跟进。写下名称和每次的任务，间隔填一百六十八小时，也就是每周一次，最多三次，再确认并启用。'),
 ('08-routine-enabled','07 / 核对频率与执行上限','查看「0/3 次」、间隔和下次时间。','启用之后，核对执行次数、间隔和下次时间。公开示例不会真的按时执行。本机版才会调度，每次调用可能消耗额度，次数上限不等于费用上限。'),
 ('09-routine-paused','08 / 随时暂停后续跟进','暂停阻止后续排队，不取消已排队任务。','点击暂停按钮，状态变为已暂停。暂停只阻止后续任务排队。如果任务已经进入队列，要单独取消；已经开始的任务，在运行详情中取消。'),
 ('10-real-result','09 / 看一条已有真实交付','这条是上一轮真实调用，不是公开示例回复。','现在切到本机版本，查看上一轮已经完成的真实任务。它回顾了长期目标，也纠正了旧背景中的能力说明。本段没有重新调用模型，不能当作新的评测成绩。'),
 ('11-real-usage','10 / 用量与费用照实记录','32,499 输入 / 578 输出 tokens；费用未报告。','交付下方记录实际用量。这个任务报告了三万两千四百九十九输入、五百七十八输出令牌。现金费用未报告，所以不能当作零成本，也不能凭空换算金额。'),
 ('01-home','轮到你：先交给它一件小事','先加目标 → 提交委托 → 看交付 → 按需跟进。','你可以先加一个目标，提交一个小委托，再检查交付。真实任务依赖本机服务，关闭页面可以继续，关机或停止服务就不能继续。邮件、日历和电脑操作目前尚未接入。'),
]
layouts={x['name']:x for x in json.loads((folder/'source/captures/layout.json').read_text())}
timeline=[];start=0
def make_canvas(i,name,title,caption,data):
    image=Image.open(folder/'source/captures'/f'{name}.jpg').convert('RGB');sw,sh=image.size
    rect=data['rect']
    if name=='07-routine-form':
        # Measured source region: task name, request, interval, limit, approval button.
        image=image.crop((1080,215,1360,560));rect=None
    if rect:
        # The saved DOM coordinates refer to this exact screenshot. Pad the region to
        # retain context, then clamp to the source viewport. Never stretch the image.
        w=min(sw,max(480,rect['w']+140)); h=min(sh,max(340,rect['h']+120))
        if name=='05-inbox': h=min(sh,520)
        if name=='10-real-result': h=min(sh,650)
        cx=rect['x']+rect['w']/2;cy=rect['y']+rect['h']/2
        left=max(0,min(sw-w,cx-w/2));top=max(0,min(sh-h,cy-h/2))
        box=(int(left),int(top),int(left+w),int(top+h));image=image.crop(box)
    canvas=Image.new('RGB',(1920,1080),'#f8f9f5');draw=ImageDraw.Draw(canvas)
    draw.rounded_rectangle((48,24,112,86),radius=14,fill='#3d654e')
    draw.text((59,37),f'{i+1:02}',font=font(30),fill='white')
    draw.text((134,25),title,font=font(64),fill='#29352e')
    badge=data['badge'] if i!=len(shots)-1 else '开始体验'
    draw.rounded_rectangle((1540,20,1870,92),radius=13,fill='#edf2ed')
    draw.text((1565,31),badge,font=font(38),fill='#557464')
    scale=min(1704/image.width,790/image.height);size=(round(image.width*scale),round(image.height*scale));image=image.resize(size,Image.Resampling.LANCZOS)
    pos=((1920-size[0])//2,112+(790-size[1])//2)
    if name=='07-routine-form':pos=(1050,112+(790-size[1])//2)
    canvas.paste(image,pos)
    draw=ImageDraw.Draw(canvas);draw.rectangle((pos[0]-1,pos[1]-1,pos[0]+size[0]+1,pos[1]+size[1]+1),outline='#d7e0d3',width=2)
    draw.line((80,928,1840,928),fill='#d7e0d3',width=2)
    lines=['']
    for c in caption:
        if draw.textlength(lines[-1]+c,font=font(64))>1740:lines.append('')
        lines[-1]+=c
    assert len(lines)<=2,caption
    for n,line in enumerate(lines):draw.text((90,944+n*74),line,font=font(64),fill='#29352e')
    if name=='07-routine-form':
        draw.text((170,230),'间隔：每周一次',font=font(48),fill='#557464')
        draw.text((170,310),'168 小时',font=font(76),fill='#29352e')
        draw.text((170,455),'最多执行',font=font(48),fill='#557464')
        draw.text((170,535),'3 次',font=font(76),fill='#29352e')
        draw.text((170,690),'核对后，确认并启用 →',font=font(52),fill='#3d654e')
    if i==len(shots)-1:
        draw.rounded_rectangle((180,265,1740,755),radius=24,fill='#3d654e')
        draw.text((235,320),'公开交互演示 · 不调用模型',font=font(54),fill='white')
        draw.text((235,430),'yiheng-guo.github.io/ai-pm-worker/personal/',font=font(48),fill='white')
        draw.text((235,585),'本机真实执行：127.0.0.1:4310',font=font(54),fill='white')
        draw.text((235,670),'公开演示不等于已部署的云端执行服务',font=font(38),fill='#dfe9d9')
    return canvas

for i,(name,title,caption,narration) in enumerate(shots):
    data=layouts[name];badge=data['badge'] if i!=len(shots)-1 else '开始体验';canvas=make_canvas(i,name,title,caption,data)
    still=work/f'{i+1:02}.png';canvas.save(still)
    speech=work/f'{i+1:02}.txt';speech.write_text(narration)
    aiff=work/f'{i+1:02}.aiff';wav=work/f'{i+1:02}.wav'
    subprocess.run(['say','-v','Tingting','-r','205','-f',str(speech),'-o',str(aiff)],check=True)
    subprocess.run([ffmpeg,'-y','-hide_banner','-loglevel','error','-i',str(aiff),'-ar','48000','-ac','1',str(wav)],check=True)
    with wave.open(str(wav)) as audio:spoken=audio.getnframes()/audio.getframerate()
    duration=max(8,math.ceil(spoken+2));clip=work/f'{i+1:02}.mp4'
    command=[ffmpeg,'-y','-hide_banner','-loglevel','error','-loop','1','-framerate','24','-i',str(still)]
    if i==5:
        for part,source,message in [('read','06-mark-read','返回对话后 → 点击「标记已读」。'),('done','06-read-complete','收件箱清空；记录仍在「持续对话」保留。')]:
            path=work/f'06-{part}.png';make_canvas(i,source,title,message,layouts[source]).save(path)
            command += ['-loop','1','-framerate','24','-i',str(path)]
        command += ['-i',str(wav),'-filter_complex',"[0:v]fade=t=in:st=0:d=0.18[b];[b][1:v]overlay=enable='gte(t,11)'[r];[r][2:v]overlay=enable='gte(t,16)'[v]",'-map','[v]','-map','3:a']
    else:command += ['-i',str(wav),'-vf','fade=t=in:st=0:d=0.18']
    command += ['-af','apad','-t',str(duration),'-c:v','libx264','-preset','veryfast','-tune','stillimage','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k',str(clip)]
    subprocess.run(command,check=True)
    timeline.append({'index':i+1,'start':start,'duration':duration,'spokenDuration':round(spoken,3),'frame':name,'title':title,'caption':caption,'narration':narration,'badge':badge});start+=duration
    print(f'{i+1}/{len(shots)} {duration}s {title}',flush=True)
concat=work/'concat.txt';concat.write_text(''.join(f"file '{work/f'{i+1:02}.mp4'}'\n" for i in range(len(shots))))
subprocess.run([ffmpeg,'-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',str(concat),'-c','copy','-movflags','+faststart',str(folder/'walkthrough.mp4')],check=True)
(folder/'timeline.json').write_text(json.dumps(timeline,ensure_ascii=False,indent=2))
Image.open(work/'01.png').save(folder/'poster.jpg',quality=92)
def ts(s):
    m=round(s*1000);return f'{m//3600000:02}:{m//60000%60:02}:{m//1000%60:02}.{m%1000:03}'
cues=['WEBVTT\n']
for shot in timeline:
    clauses=re.findall(r'[^。！？]+[。！？]?',shot['narration']);total=sum(map(len,clauses));elapsed=0
    for clause in clauses:
        duration=shot['spokenDuration']*len(clause)/total
        cues.append(f"{ts(shot['start']+elapsed)} --> {ts(shot['start']+elapsed+duration)}\n{clause}\n");elapsed+=duration
(folder/'captions.vtt').write_text('\n'.join(cues))
(folder/'transcript.md').write_text('# 亦伴 v0.6 操作教学\n\n实际操作截图剪辑，非连续录像。中文系统配音。公开示例与已有真实结果逐章标注。\n\n'+ '\n\n'.join(f"## {s['title']}\n\n{s['narration']}" for s in timeline))
print(f'完成：{start}秒，{folder / "walkthrough.mp4"}',flush=True)
