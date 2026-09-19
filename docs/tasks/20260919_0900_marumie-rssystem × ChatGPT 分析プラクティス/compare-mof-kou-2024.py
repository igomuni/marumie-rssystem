import zipfile,json,csv,os,re
from collections import Counter,defaultdict
base='/mnt/data'
with zipfile.ZipFile(base+'/mof-kou-2024.json.zip') as z:d=json.loads(z.read('mof-kou-2024.json'))
ss=d['sections']
by=defaultdict(list)
for x in ss: by[x['budgetType']].append(x)
B=['当初予算','補正予算（第1号）','決算']

def key(x):
 return (x.get('accountType',''),x.get('ministry',''),x.get('organization',''),x.get('specialAccount',''),x.get('subAccount',''),x.get('agency',''),x.get('sectionCode',''),x.get('sectionName',''))
sets={b:{key(x):x for x in by[b]} for b in B}
print({b:len(sets[b]) for b in B})
# overlap Venn membership counts
allk=set().union(*[set(sets[b]) for b in B])
c=Counter(tuple(k in sets[b] for b in B) for k in allk)
print('membership',c)
# per account
for a in ['general','special','agency']:
 print(a,{b:sum(x['accountType']==a for x in by[b]) for b in B})
# transition counts
for a,b in [(B[0],B[1]),(B[0],B[2]),(B[1],B[2])]:
 A=set(sets[a]); C=set(sets[b]); print(a,'->',b,'common',len(A&C),'onlyA',len(A-C),'onlyB',len(C-A))
# output comparison csv
out=base+'/mof-kou-2024-budget-type-comparison.csv'
fields=['accountType','ministry','organization','specialAccount','subAccount','agency','sectionCode','sectionName','inInitial','inSupplement','inSettlement','initialAmount','supplementAmount','settlementAmount','initialDetailCount','supplementDetailCount','settlementDetailCount','supplementHasOutsideN','membershipPattern']
with open(out,'w',newline='',encoding='utf-8-sig') as f:
 w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
 for k in sorted(allk):
  vals=[sets[b].get(k) for b in B]
  basev=next(v for v in vals if v)
  flags=[v is not None for v in vals]
  sv=vals[1]
  w.writerow(dict(zip(fields[:8],k)) | {
   'inInitial':int(flags[0]),'inSupplement':int(flags[1]),'inSettlement':int(flags[2]),
   'initialAmount':vals[0]['amount'] if vals[0] else '', 'supplementAmount':vals[1]['amount'] if vals[1] else '', 'settlementAmount':vals[2]['amount'] if vals[2] else '',
   'initialDetailCount':len(vals[0].get('detailNames',[])) if vals[0] else '', 'supplementDetailCount':len(vals[1].get('detailNames',[])) if vals[1] else '', 'settlementDetailCount':len(vals[2].get('detailNames',[])) if vals[2] else '',
   'supplementHasOutsideN':int(any(re.search(r'外\d+目',s or '') for s in sv.get('detailNames',[]))) if sv else '',
   'membershipPattern':''.join('I' if flags[0] else '-')+''.join('S' if flags[1] else '-')+''.join('F' if flags[2] else '-')})
print('csv',out,len(allk))
# examples only settlement
for pat in [(False,False,True),(True,False,True),(True,True,False),(False,True,True)]:
 arr=[]
 for k in allk:
  if tuple(k in sets[b] for b in B)==pat: arr.append(k)
 print('\nPAT',pat,'n',len(arr))
 for x in sorted(arr)[:10]: print(x)
