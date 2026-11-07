"""HTTP validation and identity boundary for team business."""

from fastapi import Depends, Path
from sqlalchemy.orm import Session

from . import team_business as service
from .async_api import AsyncAPIRouter as APIRouter
from .auth import get_current_user, require_admin
from .database import get_db
from .models import (
    User,
)
from .team_business import DirectoryItemInput, OpeningAuthorization
from .team_business_schemas import (
    OpeningAuthorizationResponse,
    TeamDirectoryItemResponse,
    TeamProcessingTaskResponse,
)

router = APIRouter(prefix="/api/team-materials", tags=["team business settings"])


@router.get("/{team_id}/purposes", response_model=list[TeamDirectoryItemResponse])
def list_purposes(
    team_id: int = Path(ge=1), _: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.list_purposes(team_id=team_id, _=_, db=db)


@router.post("/{team_id}/purposes", response_model=TeamDirectoryItemResponse, status_code=201)
def create_purpose(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.save_directory_item(db, team_id, user, payload)


@router.patch("/{team_id}/purposes/{purpose_id}", response_model=TeamDirectoryItemResponse)
def update_purpose(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    purpose_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.save_directory_item(db, team_id, user, payload, purpose_id)


@router.get("/{team_id}/employees", response_model=list[TeamDirectoryItemResponse])
def list_employees(
    team_id: int = Path(ge=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.list_employees(team_id=team_id, user=user, db=db)


@router.post("/{team_id}/employees", response_model=TeamDirectoryItemResponse, status_code=201)
def create_employee(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.save_directory_item(db, team_id, user, payload, employee=True)


@router.patch("/{team_id}/employees/{employee_id}", response_model=TeamDirectoryItemResponse)
def update_employee(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    employee_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.save_directory_item(db, team_id, user, payload, employee_id, employee=True)


@router.get("/{team_id}/processing-tasks", response_model=list[TeamProcessingTaskResponse])
def list_processing_tasks(
    team_id: int = Path(ge=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.list_processing_tasks(team_id=team_id, user=user, db=db)


@router.post(
    "/{team_id}/processing-tasks", response_model=TeamProcessingTaskResponse, status_code=201
)
def create_processing_task(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.save_directory_item(db, team_id, user, payload, processing_task=True)


@router.patch("/{team_id}/processing-tasks/{task_id}", response_model=TeamProcessingTaskResponse)
def update_processing_task(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    task_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.save_directory_item(db, team_id, user, payload, task_id, processing_task=True)


@router.get("/{team_id}/inspection-problems", response_model=list[TeamDirectoryItemResponse])
def list_inspection_problems(
    team_id: int = Path(ge=1), _: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.list_inspection_problems(team_id=team_id, _=_, db=db)


@router.post(
    "/{team_id}/inspection-problems", response_model=TeamDirectoryItemResponse, status_code=201
)
def create_inspection_problem(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.save_directory_item(db, team_id, user, payload, inspection_problem=True)


@router.patch(
    "/{team_id}/inspection-problems/{problem_id}", response_model=TeamDirectoryItemResponse
)
def update_inspection_problem(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    problem_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.save_directory_item(
        db, team_id, user, payload, problem_id, inspection_problem=True
    )


@router.put("/{team_id}/opening-stock/authorization", response_model=OpeningAuthorizationResponse)
def authorize_opening(
    payload: OpeningAuthorization,
    team_id: int = Path(ge=1),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return service.authorize_opening(payload=payload, team_id=team_id, user=user, db=db)
