## TODOs

MAY 9 WHATS LEFT:

Features:
- Installment Claim (and grace period?)
- Signature expiry
- Native rollovers

#### Evan:

> V2 Protocol Planning/ Progress Report:

- (IN PROGRESS) Installment claims:
  - GRACE_PERIOD for late repayments after loanDuration?
  - MAX_INSTALLMENTS_MISSED_FOR_LENDER_CLAIM?
    - 3?
      - How does this effect the various loan terms scenarios?
  - Is a repayment LATE_FEE of 0.5% what we want?
- (REVIEW) Loan Terms Restrictions:
  - durationsSecs and numInstallments

> Branch Notes:

- `installment-claims` branch:
  1. Claiming after (x) amount of CONSECUTIVE missed installment payments.
  2. Global late fee adjustment, Currently (0.5%)
  3. Restrictions around LATE_FEE and numInstallments when creating a loan.
  4. How to differentiate between legacy loan claims and installment claim scenarios
  5. Tests for installment loan claiming scenarios
    - Number of installments missed for claiming, consecutive an non-consecutive...
    - Calling before and after the repayment grace period...
    - Legacy vs installments lender claiming scenarios, protections from overlap...
    - If the LATE_FEE parameter is changed, lots of installment calculations regarding late fees will need re-calculation

Mouzayan:

- Upgradeability and dependency architecture\
  ✅ &nbsp; Decide - which contracts should be upgradeable? What upgradebility pattern should they use?\
  ✅ &nbsp; Decide - which dependencies need to get passed in constructors for each contract?\
  ✅ &nbsp; Decide - of those dependencies, which should be changeable by an admin? Which should be immutable and / or only changeable by upgrade?\
  ✅ &nbsp; Outline the path to UUPS + ways to avoid storage clashes
- Outline changes to v2 Protocol to add upgradeability

✅ &nbsp; Future Scenarios List: What May Need to Change in the Future Scenarios\
✅ &nbsp; For each scenario, how would we make it possible? admin function or upgradeability etc...

✅ &nbsp; Look into [OZ upgrades plugin](https://docs.openzeppelin.com/upgrades-plugins/1.x/) for checks for conflicts, adds a deployment history you can check into git, wrapped "upgrade" functions for deploy scripts + other features\
✅ &nbsp; Compare with [Slither](https://github.com/crytic/slither/wiki/Upgradeability-Checks) plugin

✅ &nbsp; Review Origination PR

- Review Installments PR

Kevin:

- Write Origination tests
- Review installments PR

Leftover:

- Native rollovers
- Custom errors
- Move compiler to 0.8.11
- Re-do natspec - move to implementation, not interfaces
- Testing with full coverage
