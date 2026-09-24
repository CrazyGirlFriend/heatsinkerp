import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.legacy_models import Operation, OperationReport, Product, ProductRouteOperation, WorkOrder
from app.models import AdminAuditEvent, Team, TeamPurpose
from app.retire_legacy_teams import retire_legacy_teams


def legacy_rows(client):
    actor = client.get('/api/auth/me').json()['id']
    with SessionLocal() as db:
        warehouse = Team(code='FACTORY-WAREHOUSE', name='库房', kind='warehouse')
        qc = Team(code='FACTORY-QC', name='检验')
        scrap = Team(code='FACTORY-SCRAP', name='转废', kind='scrap', active=False)
        ship = Team(code='FACTORY-SHIP', name='发货')
        db.add_all([warehouse, qc, scrap, ship])
        db.flush()
        product = Product(code='OLD', name='旧产品')
        order = WorkOrder(order_no='00001', product_name='旧工单', planned_quantity=10, created_by='旧账号')
        db.add_all([product, order])
        db.flush()
        route = ProductRouteOperation(product_id=product.id, sequence=1, code='SHIP', name='发货', responsible_team_id=ship.id)
        operation = Operation(work_order_id=order.id, sequence=1, code='SHIP', name='发货', responsible_team_id=ship.id, responsible_team_name='发货')
        db.add_all([route, operation])
        db.flush()
        report = OperationReport(operation_id=operation.id, reported_quantity=10, qualified_quantity=9,
                                 scrapped_quantity=1, scrap_reason='旧记录', operator='旧账号',
                                 scrap_destination_team_id=scrap.id, scrap_destination_team_name='转废')
        db.add(report)
        db.commit()
        return actor, scrap.id, ship.id, warehouse.id, qc.id, report.id, operation.id, route.id


def test_retirement_preserves_records_and_audits_original_ownership(client):
    actor, scrap, ship, warehouse, qc, report, operation, route = legacy_rows(client)
    with SessionLocal() as db:
        result = retire_legacy_teams(db, actor)
        db.commit()
        assert [row['historical_rows_reassigned'] for row in result] == [1, 2]
        assert db.get(Team, scrap) is None and db.get(Team, ship) is None
        row = db.get(OperationReport, report)
        assert row.scrap_destination_team_id == warehouse and row.scrap_destination_team_name == '库房'
        assert row.scrapped_quantity == 1 and row.scrap_reason == '旧记录'
        assert db.get(Operation, operation).responsible_team_id == qc
        assert db.get(ProductRouteOperation, route).responsible_team_id == qc
        audits = db.scalars(select(AdminAuditEvent).where(AdminAuditEvent.action == 'deleted')).all()
        assert len(audits) == 2
        assert audits[0].changes['references'][0]['before'][0]['scrap_destination_team_name'] == '转废'
        assert retire_legacy_teams(db, actor) == []


def test_unexpected_reference_rolls_back_both_teams(client):
    actor, scrap, ship, _, _, report, _, _ = legacy_rows(client)
    with SessionLocal() as db:
        db.add(TeamPurpose(team_id=ship, name='已有用途', active=True))
        db.commit()
    with SessionLocal() as db:
        with pytest.raises(ValueError, match='Unexpected reference'):
            retire_legacy_teams(db, actor)
        db.rollback()
        assert db.get(Team, scrap) is not None and db.get(Team, ship) is not None
        assert db.get(OperationReport, report).scrap_destination_team_id == scrap
        assert db.scalar(select(AdminAuditEvent).where(AdminAuditEvent.action == 'deleted')) is None


@pytest.mark.parametrize('payload', [
    {'code': 'SCRAP', 'name': '其他', 'kind': 'scrap'},
    {'code': 'FACTORY-SCRAP', 'name': '其他'},
    {'code': 'FACTORY-SHIP', 'name': '其他'},
    {'code': 'OTHER', 'name': '转废'},
    {'code': 'OTHER', 'name': '发货'},
])
def test_obsolete_teams_cannot_be_created_or_reintroduced_by_edit(client, payload):
    assert client.post('/api/teams', json=payload).status_code == 422
    team = client.post('/api/teams', json={'code': 'NORMAL', 'name': '普通班组'}).json()
    assert client.patch(f"/api/teams/{team['id']}", json=payload).status_code == 422
    assert client.get(f"/api/teams/{team['id']}").json()['name'] == '普通班组'
