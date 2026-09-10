from starlette.routing import Match
from routes.whatsapp import router


def test_job_list_resolves_before_dynamic_branch_config():
    scope = {
        "type": "http", "method": "GET",
        "path": "/whatsapp/branch-cloud/jobs", "root_path": "",
    }
    matches = [route for route in router.routes if route.matches(scope)[0] == Match.FULL]
    assert matches
    assert matches[0].endpoint.__name__ == "list_branch_cloud_jobs"