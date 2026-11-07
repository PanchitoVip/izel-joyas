import json,os
from PIL import Image,ImageOps
BASE=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT=BASE+'/catalogo'
IG=BASE+'/fuentes/instagram'
os.makedirs(ROOT+'/img/productos',exist_ok=True); os.makedirs(ROOT+'/data',exist_ok=True)
P925='Plata 925'
# (foto, nombre, categoria, material, descripcion, centro_recorte, a_revisar, destacado)
items=[
('DcWlrHQNoTD','Anillo Arcoíris Baguette','Anillos',P925,'Media alianza con piedras baguette en degradé de colores.',(160,358),0,1),
('DcWlk2ztQUC','Anillo Flor de Colores','Anillos',P925,'Flor de cinco pétalos con piedras en forma de gota.',(230,343),0,1),
('DcWlZkWtN9k','Anillo Ramo Pastel','Anillos',P925,'Racimo de piedras en tonos pastel, delicado y luminoso.',(211,347),0,1),
('DcWlONKtgos','Anillo Ola Arcoíris','Anillos',P925,'Banda ondulada con piedras de colores en línea.',(222,347),0,0),
('DcWlVxtNL2L','Anillo Solitario Arcoíris','Anillos',P925,'Piedra central cuadrada con laterales de colores.',(277,385),0,0),
('DcWlhcKNG98','Anillo Banda Arcoíris','Anillos',P925,'Banda fina con piedras cuadradas de colores.',(257,304),0,0),
('DcWlnqBNZu-','Anillo Puntos Azules','Anillos',P925,'Banda lisa con piedras redondas engarzadas al ras.',(228,400),0,0),
('C1dKIOYsv_k','Pulsera Infinito','Pulseras',P925,'Símbolo infinito con microengarce de piedras.',None,0,1),
('C1dKT5SsMWy','Pulsera Estrellas','Pulseras',P925,'Cadena de estrellitas con una estrella brillante.',None,1,0),
('C1dKOQyMo4u','Pulsera Piedras de Colores','Pulseras',P925,'Línea de piedras redondas de colores en cadena fina.',None,0,0),
('C1dKdmMMg1q','Pulsera Hojas','Pulseras',P925,'Cadena con dijes colgantes en forma de hoja.',None,0,0),
('C1dJ_6Is4nU','Pulsera Virgen','Pulseras',P925,'Medalla oval de la Virgen rodeada de piedras.',None,1,1),
('C17zYA6uzML','Pulsera Cristales Multicolor','Pulseras',P925+' y cristal','Cristales de colores con bolitas de plata.',None,0,0),
('C17zS2puEDG','Pulsera Roja Punto de Luz','Pulseras',P925+' y cristal','Cristales rojos con piedra central engarzada.',None,0,0),
('C17zLEJudWM','Pulsera Cristal y Tubo','Pulseras',P925+' y cristal','Cristales en azul o celeste con tubo curvo de plata.',None,0,0),
('CzJTQu5MyqU','Pulsera Corazón Negro','Pulseras',P925+' y cristal','Cristales negros con corazón colgante.',None,0,0),
('CzJTBIZs0mu','Pulsera Corazón Bordó','Pulseras',P925+' y cristal','Cristales bordó con corazón colgante.',None,0,0),
('CyysedjurIY','Pulseras de Cristales','Pulseras',None,'Pulseras de cristales en varios colores.',None,1,0),
('C0w6HarOFBO','Gargantilla Colibrí','Gargantillas',P925,'Colibrí calado en cadena fina con bolitas. Hecha en México.',None,0,1),
('C0w59iiuoho','Gargantilla Corazón de Cristal','Gargantillas',P925+' y cristal','Corazón de cristal ámbar. Hecha en México.',None,0,1),
('C1ASAjzu-fg','Gargantilla Cristal y Corazón','Gargantillas',P925+' y cristal','Hilo de cristales transparentes con corazón ámbar.',None,0,0),
('CyUBhZpu92o','Gargantilla Cascada de Colores','Gargantillas',P925,'Cadena con caída de piedras redondas de colores.',None,0,0),
('CzmoQMksWYC','Gargantilla Corazón Rojo','Gargantillas',None,'Cristales rojos con corazón central.',None,1,0),
('CyRSclBOb3C','Cadena y Dije Trébol de Corazones','Cadenas y dijes',P925,'Cuatro corazones calados, uno con piedras.',None,0,1),
('C0u1fDbsu52','Dije Cruz Turquesa','Cadenas y dijes',P925,'Cruz trabajada con detalles en turquesa.',None,0,0),
('C0u1EiNMyhp','Dije Cruz de Colores','Cadenas y dijes',P925,'Cruz con piedras en azul, turquesa y rojo.',None,0,0),
('C0u1NN3MAOO','Dijes Surtidos','Cadenas y dijes',P925,'Plumas, lunas, gatita y cruces. Consultá por el modelo que te guste.',None,0,0),
('DVHYNc-FcwC','Dije Inicial','Cadenas y dijes',None,'Letra inicial en hilo invisible. Consultá por tu letra.',None,1,0),
('CzE4QRKObaj','Dije Argolla de Oro','Cadenas y dijes','Oro 18k','Argolla lisa de oro en estuche.',None,1,0),
('C2-9o8-MXkh','Aros Argolla Inflada','Aros','Plata 925 inflada','Argollas gruesas y livianas con cierre a presión.',None,0,1),
]
out=[]
for i,(src,nom,cat,mat,desc,c,rev,dest) in enumerate(items,1):
    im=Image.open(f'{IG}/{src}.jpg').convert('RGB')
    if c:
        w,h=400,500
        x=min(max(c[0]-w//2,0),im.width-w); y=min(max(c[1]-h//2,0),im.height-h)
        im=im.crop((x,y,x+w,y+h)).resize((640,800),Image.LANCZOS)
    code=f'IZ-{i:03d}'; f=code.lower()+'.jpg'
    im.save(ROOT+'/img/productos/'+f,quality=86,optimize=True,progressive=True)
    out.append(dict(codigo=code,nombre=nom,categoria=cat,material=mat,descripcion=desc,imagen='img/productos/'+f,destacado=bool(dest),revisar=bool(rev),instagram=src))
json.dump(dict(productos=out),open(ROOT+'/data/productos.json','w',encoding='utf8'),ensure_ascii=False,indent=1)
Image.open(IG+'/DKzv7mfsMo4.jpg').convert('RGB').save(ROOT+'/img/logo.jpg',quality=90)
print(len(out),[o['codigo'] for o in out if o['revisar']])
