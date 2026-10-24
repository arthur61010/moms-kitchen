import base64, io, json, sys, time, urllib.request
from PIL import Image
def img(path):
    im=Image.open(path).convert('RGB'); im.thumbnail((1280,1280)); b=io.BytesIO(); im.save(b,'JPEG',quality=85)
    return 'data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode()
import os
PASS=os.environ.get('APP_PASSCODE','')
def post(p, d):
    d=dict(d, passcode=PASS, device='e2e-test-device')
    t=time.time(); r=urllib.request.urlopen(urllib.request.Request('http://localhost:8787'+p, json.dumps(d).encode(), {'Content-Type':'application/json'}), timeout=120)
    return json.load(r), time.time()-t
for path, kind in [('test/order.png','order'),('test/Open_refrigerator_with_food_at_night.jpg','fridge')]:
    j,t=post('/api/ingredients',{'image':img(path),'kind':kind})
    ings=j.get('ingredients',[]); print(f'== {path} ingredients {t:.1f}s mock={j.get("mock")}')
    print('  ', '、'.join(f"{i['name']}({i.get('amount','')})" for i in ings))
    j,t=post('/api/recipes',{'ingredients':[(i['name']+' '+i.get('amount','')).strip() for i in ings]})
    print(f'   recipes {t:.1f}s:', ' / '.join(f"{r['name']}[{r.get('time')}, {len(r.get('steps',[]))}步]" for r in j.get('recipes',[])))
    json.dump(j, open(f'test/out_{kind}.json','w'), ensure_ascii=False, indent=1)
