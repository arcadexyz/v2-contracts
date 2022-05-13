## TODOs

MAY 9 WHATS LEFT:

Features:
- Installment Claim (and grace period?)
- Signature expiry
- Native rollovers

#### Evan:

> V2 Protocol Planning/ Progress:

- (IN PROGRESS) Installment Claims:
  - MISSED_INSTALLMENTS_FOR_LENDER_CLAIM
    - 40% the total `numInstallments` in LoanTerms. --> Add custom error to `claim` in repayment controller for loans where `numInstallments != 0` (this indicates an installment loan). For default to be triggered, borrower must miss payments consecutively due to the fact that `numInstallmentsPaid` gets updated every time a payment is made to the current installment period when payment is made.
      - Remove all `GRACE_PERIOD` variables, new method for determining default.
      - Implementation:
        - Create onlyOwner update function for a state variable.
        - Need to add to LoanTerms struct? Or is this parameter we should add to the LoanLibrary?
      - Create tests
- (REVEIW) Is a repayment LATE_FEE of 0.5% what we want? --> Gabe did not have any objection...
- (IN PROGRESS) Loan Terms Restrictions:
  - `durationsSecs` and `numInstallments`
   - Max `numInstallments` in LoanTerms to be changed to 1000 installments.
   - Need to add more tests around the smaller duration loans after the claiming is implemented.

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
