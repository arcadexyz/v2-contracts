## TODOs

MAY 9 WHATS LEFT:

Features:
- Installment Claim (and grace period?)
- Signature expiry
- Native rollovers

 Evan:

> V2 Protocol Planning/ Progress:

- (REVIEW) Installment Claims:
  - MISSED_INSTALLMENTS_FOR_LENDER_CLAIM
    - 40% the total `numInstallments` in LoanTerms. --> Add custom error for loans where `numInstallments != 0` (this indicates an installment loan). For default to be triggered, borrower must miss payments consecutively due to the fact that `numInstallmentsPaid` gets updated every time a payment is made to the current installment period when payment is made.
      - (DONE) Remove all `GRACE_PERIOD` variables, new method for determining default.
      - Implementation:
        - new internal function in loan core
      - Create tests
  - Added custom error to repay to restrict to only legacy loan types.
- (REVEIW) Repayment LATE_FEE  --> Should this be in the feeController? Potential PR
- (IN PROGRESS) Loan Terms Restrictions:
  - `durationsSecs` and `numInstallments`
   - (NEXT PR) Max `numInstallments` in LoanTerms changed to 1000 installments.
   - Need to add more tests around the smaller duration loans after the claiming is implemented.

> Branch Notes:

- `installment-claims` branch:
  - Global late fee adjustment (0.4%)
  - I chose to stay away from creating a onlyOwner set function for one main reason. If we did this, and changed the value while there are active loans, that would be breach of trust with the lending parties especially the borrower. The second reason is due to the solution to the previous problem. This is that in order to overcome this we would be adding this global value to either LoanTerms or LoanData. We don't like LoanTerms because this is something else to agree upon, and it doesn't really fit into LoanData as a static value only updated by contract owner. 
  - Tests for installment loan claiming scenarios
    - Number of installments missed for claiming, consecutive an non-consecutive...
    - Legacy vs installments lender claiming scenarios, protections from overlap...

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
