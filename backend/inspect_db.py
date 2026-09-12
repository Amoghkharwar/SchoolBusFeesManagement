import asyncio, os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()
async def main():
    client = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = client['schoolbusfees']
    students = await db.students.find({}, {'_id': 0}).to_list(1000)
    print(f'Total students: {len(students)}')
    for s in students:
        payments = await db.payments.find({'student_id': s['id']}, {'_id': 0}).to_list(100)
        paid = sum(float(p['amount']) for p in payments)
        print(f"Name: {s.get('name')}, AdmDate: {s.get('admission_date')}, Yearly: {s.get('yearly_fee')}, Paid: {paid}, Payments: {len(payments)}")
        for p in payments:
            print(f"   payment_date: {p.get('payment_date')}, amount: {p.get('amount')}")

asyncio.run(main())
